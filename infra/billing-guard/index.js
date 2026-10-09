import functions from '@google-cloud/functions-framework'

/**
 * Billing kill switch: the budget posts its current cost (credits excluded) to Pub/Sub several
 * times a day. Once the cost reaches LIMIT, the project is unlinked from its billing account, which
 * stops every paid service. Relinking is a manual step in the console.
 */
const PROJECT = process.env.PROJECT_ID
const LIMIT = Number(process.env.LIMIT)
const API = 'https://cloudbilling.googleapis.com/v1'

async function accessToken() {
  const res = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } },
  )
  if (!res.ok) throw new Error(`metadata token: ${res.status}`)
  return (await res.json()).access_token
}

async function billing(method, token, body) {
  const res = await fetch(`${API}/projects/${PROJECT}/billingInfo`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`billingInfo ${method}: ${res.status}`)
  return res.json()
}

functions.cloudEvent('guard', async (event) => {
  if (!PROJECT || !(LIMIT > 0)) throw new Error('PROJECT_ID and LIMIT must be set')
  const data = JSON.parse(Buffer.from(event.data.message.data, 'base64').toString())
  const cost = Number(data.costAmount)
  // A manual check message ({"check": true}) only proves the permissions without unlinking
  if (data.check === true) {
    const token = await accessToken()
    const info = await billing('GET', token)
    console.log(`check: billingEnabled=${info.billingEnabled}, limit=${LIMIT}`)
    return
  }
  if (!Number.isFinite(cost) || cost < LIMIT) return
  const token = await accessToken()
  const info = await billing('GET', token)
  if (!info.billingEnabled) return
  await billing('PUT', token, { billingAccountName: '' })
  console.log(`billing disabled: cost ${cost} reached limit ${LIMIT}`)
})
