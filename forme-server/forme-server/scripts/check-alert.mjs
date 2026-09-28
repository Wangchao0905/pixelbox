import assert from 'node:assert/strict'
import { config } from '../src/config.mjs'
import { notify, inspectAlertConfig } from '../src/alert.mjs'

const previous = { alert: { ...config.alert }, production: config.isProduction, fetch: globalThis.fetch, warn: console.warn, error: console.error }
const logs = []
let calls = 0
try {
  console.warn = console.error = (...args) => logs.push(args.join(' '))
  config.isProduction = true
  config.alert.webhookUrl = 'https://alert.invalid/hook?key=SECRET_TEST_TOKEN'
  for (const [format, success] of [['wecom', {errcode: 0}], ['dingtalk', {errcode: 0}], ['feishu', {code: 0}], ['generic', null]]) {
    config.alert.format = format
    globalThis.fetch = async (url, options) => {
      calls++
      assert.equal(url, config.alert.webhookUrl)
      assert.equal(options.redirect, 'error')
      assert.ok(options.signal instanceof AbortSignal)
      const body = JSON.parse(options.body)
      if (format === 'wecom' || format === 'dingtalk') assert.match(body.text.content, /test-event/)
      if (format === 'feishu') assert.match(body.content.text, /test-event/)
      if (format === 'generic') assert.equal(body.event, 'test-event')
      return success ? Response.json(success) : new Response(null, {status: 204})
    }
    assert.equal((await notify('warn', 'test-event', { test: true })).ok, true)
  }
  assert.equal(calls, 4)
  config.alert.format = 'wecom'
  for (const response of [Response.json({errcode: 93000}), Response.json({}), new Response('not-json'), new Response(null, {status: 500})]) {
    globalThis.fetch = async () => response
    assert.equal((await notify('critical', 'test-event')).ok, false)
  }
  config.alert.format = 'feishu'
  globalThis.fetch = async () => Response.json({code: 19022})
  assert.equal((await notify('warn', 'test-event')).ok, false)
  globalThis.fetch = async () => { throw new Error('https://alert.invalid/hook?key=SECRET_TEST_TOKEN') }
  assert.equal((await notify('warn', 'test-event')).ok, false)
  assert.ok(!logs.join('\n').includes('SECRET_TEST_TOKEN'))
  globalThis.fetch = () => { throw new Error('configuration validation must prevent fetch') }
  config.alert.webhookUrl = ''
  assert.equal((await notify('warn', 'test-event')).ok, false)
  config.alert.webhookUrl = 'http://alert.invalid'
  assert.match(inspectAlertConfig(), /HTTPS/)
  config.alert.webhookUrl = 'https://alert.invalid'
  config.alert.format = 'unknown'
  assert.match(inspectAlertConfig(), /不受支持/)
  console.log('告警测试通过：四种消息格式、HTTP/平台拒绝、异常收敛、配置验证及密钥脱敏。未发送外部消息。')
} finally {
  Object.assign(config.alert, previous.alert)
  config.isProduction = previous.production
  globalThis.fetch = previous.fetch
  console.warn = previous.warn
  console.error = previous.error
}
