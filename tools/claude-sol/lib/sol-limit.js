const baseUrl = (process.env.SOL_BASE_URL || 'https://openrouter.ai/api').replace(/\/+$/, '')
const inferenceKey = process.env.SOL_INFERENCE_KEY || ''
const provisioningKey = process.env.SOL_PROVISIONING_KEY || ''
const statePath = process.env.SOL_STATE_FILE || ''
const baselineLimit = process.env.SOL_BASELINE_LIMIT || ''
const keyHashOverride = process.env.SOL_KEY_HASH || ''

const fs = require('node:fs')

function utcDate(dayOffset) {
    const moment = new Date()

    moment.setUTCDate(moment.getUTCDate() + dayOffset)

    return moment.toISOString().slice(0, 10)
}

function formatMoney(amount) {
    if (amount === null || amount === undefined) {
        return 'unlimited'
    }

    return '$' + Number(amount).toFixed(2)
}

async function callApi(method, path, apiKey, body) {
    const response = await fetch(baseUrl + path, {
        method,
        headers: {
            Authorization: 'Bearer ' + apiKey,
            'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    })

    let payload = null

    try {
        payload = await response.json()
    }
    catch {
        payload = null
    }

    return { status: response.status, payload }
}

function fail(message) {
    console.error(message)

    process.exit(1)
}

async function readCurrentKey() {
    if (!inferenceKey) {
        fail('no openrouter api key available — run claude-sol --sol-setup')
    }

    const { status, payload } = await callApi('GET', '/v1/key', inferenceKey)

    if (status !== 200) {
        fail('openrouter rejected the key lookup (http ' + status + ')')
    }

    return payload.data || payload
}

async function resolveKeyHash(currentKey) {
    if (keyHashOverride) {
        return keyHashOverride
    }

    if (!provisioningKey) {
        fail('raising or resetting the limit needs a provisioning key — run claude-sol --sol-provision-setup')
    }

    const { status, payload } = await callApi('GET', '/v1/keys', provisioningKey)

    if (status !== 200) {
        fail('could not list keys (http ' + status + '). is that a provisioning key, not an inference key?')
    }

    const keys = (payload && payload.data) || []
    const byLabel = keys.filter((entry) => entry.label && currentKey.label && entry.label === currentKey.label)

    if (byLabel.length === 1) {
        return byLabel[0].hash
    }

    if (keys.length === 1) {
        return keys[0].hash
    }

    fail('could not tell which of ' + keys.length + ' keys is in use — set CLAUDE_SOL_KEY_HASH in ~/.config/claude-sol/config')
}

function readState() {
    if (!statePath || !fs.existsSync(statePath)) {
        return null
    }

    try {
        return JSON.parse(fs.readFileSync(statePath, 'utf8'))
    }
    catch {
        return null
    }
}

function writeState(state) {
    fs.mkdirSync(require('node:path').dirname(statePath), { recursive: true })
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
}

function clearState() {
    if (statePath && fs.existsSync(statePath)) {
        fs.rmSync(statePath)
    }
}

async function applyLimit(keyHash, limitValue) {
    const { status, payload } = await callApi('PATCH', '/v1/keys/' + keyHash, provisioningKey, { limit: limitValue })

    if (status !== 200) {
        fail('openrouter refused the limit change (http ' + status + '): ' + JSON.stringify(payload))
    }

    return payload
}

async function commandShow() {
    const currentKey = await readCurrentKey()
    const state = readState()

    console.log('label             ' + (currentKey.label || '(unnamed)'))
    console.log('limit             ' + formatMoney(currentKey.limit))
    console.log('used              ' + formatMoney(currentKey.usage))

    if (currentKey.limit_remaining !== undefined && currentKey.limit_remaining !== null) {
        console.log('remaining         ' + formatMoney(currentKey.limit_remaining))
    }

    console.log('resets            ' + (currentKey.limit_reset || 'never'))
    console.log('shared baseline   ' + (baselineLimit ? formatMoney(baselineLimit) : '(none set)'))

    if (state) {
        console.log('temporary raise   ' + formatMoney(state.raised_to) + ' until ' + state.reset_on + ' utc (was ' + formatMoney(state.previous_limit) + ')')
    }
    else {
        console.log('temporary raise   none active')
    }
}

async function commandRaise(requestedLimit) {
    const amount = Number(requestedLimit)

    if (!Number.isFinite(amount) || amount <= 0) {
        fail('usage: claude-sol --sol-limit-raise <usd amount>')
    }

    const currentKey = await readCurrentKey()
    const keyHash = await resolveKeyHash(currentKey)
    const existingState = readState()
    const previousLimit = existingState ? existingState.previous_limit : currentKey.limit

    await applyLimit(keyHash, amount)

    writeState({
        key_hash: keyHash,
        previous_limit: previousLimit === undefined ? null : previousLimit,
        raised_to: amount,
        raised_on: utcDate(0),
        reset_on: utcDate(1),
    })

    console.log('limit raised to ' + formatMoney(amount) + ' at openrouter.')
    console.log('it drops back to ' + formatMoney(baselineLimit || previousLimit) + ' on ' + utcDate(1) + ' utc, on the next claude-sol launch.')
}

async function commandReset(quiet) {
    const state = readState()

    if (!state) {
        if (!quiet) {
            console.log('no temporary raise is active.')
        }

        return
    }

    const targetLimit = baselineLimit ? Number(baselineLimit) : state.previous_limit
    const keyHash = state.key_hash || (await resolveKeyHash(await readCurrentKey()))

    await applyLimit(keyHash, targetLimit === undefined ? null : targetLimit)

    clearState()

    console.log('limit reset to ' + formatMoney(targetLimit) + ' at openrouter.')
}

async function commandAutoReset() {
    const state = readState()

    if (!state || !state.reset_on || utcDate(0) < state.reset_on) {
        return
    }

    await commandReset(true)
}

const command = process.argv[2]

const runners = {
    show: () => commandShow(),
    raise: () => commandRaise(process.argv[3]),
    reset: () => commandReset(false),
    'auto-reset': () => commandAutoReset(),
}

if (!runners[command]) {
    fail('unknown limit command: ' + command)
}

runners[command]().catch((error) => fail('limit command failed: ' + error.message))
