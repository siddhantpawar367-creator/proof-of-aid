import { BrowserProvider, Contract, Interface, JsonRpcProvider, ZeroHash, id } from 'ethers'
import { proofOfAidAbi } from './abi'
import { CONTRACT_ADDRESS, SEPOLIA_CHAIN_ID, SEPOLIA_RPC } from './config'

// ---------------------------------------------------------------------------
// Wallet typing
// ---------------------------------------------------------------------------

// Minimal shape of the wallet object MetaMask injects into the page.
type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on: (event: string, handler: () => void) => void
  removeListener: (event: string, handler: () => void) => void
}

declare global {
  interface Window {
    ethereum?: EthereumProvider
  }
}

// ---------------------------------------------------------------------------
// Contract access
// ---------------------------------------------------------------------------

// Reads go through a public RPC so the data is visible without a wallet.
const readProvider = new JsonRpcProvider(SEPOLIA_RPC, SEPOLIA_CHAIN_ID, { staticNetwork: true })
export const readContract = new Contract(CONTRACT_ADDRESS, proofOfAidAbi, readProvider)

// Writes go through the connected wallet, which signs every transaction.
export async function getWriteContract(): Promise<Contract> {
  if (!window.ethereum) throw new Error('No wallet found.')
  const signer = await new BrowserProvider(window.ethereum).getSigner()
  return new Contract(CONTRACT_ADDRESS, proofOfAidAbi, signer)
}

// Sends one transaction, waits for it to be mined, and resolves true on success.
export type RunTx = (
  label: string,
  send: (contract: Contract) => Promise<{ wait: () => Promise<unknown> }>,
) => Promise<boolean>

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

// Role ids are the same hashes the contract uses (keccak256 of the role name).
export const ADMIN_ROLE = ZeroHash // DEFAULT_ADMIN_ROLE is bytes32(0)
export const NGO_ROLE = id('NGO_ROLE')
export const VERIFIER_ROLE = id('VERIFIER_ROLE')

export type Roles = { admin: boolean; ngo: boolean; verifier: boolean }

export async function loadRoles(contract: Contract, account: string): Promise<Roles> {
  const [admin, ngo, verifier] = (await Promise.all([
    contract.hasRole(ADMIN_ROLE, account),
    contract.hasRole(NGO_ROLE, account),
    contract.hasRole(VERIFIER_ROLE, account),
  ])) as [boolean, boolean, boolean]
  return { admin, ngo, verifier }
}

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

const CAMPAIGN_STATUS = ['Active', 'Closed'] as const
const RECORD_STATUS = ['Pending', 'Approved', 'Rejected'] as const

export type CampaignStatus = (typeof CAMPAIGN_STATUS)[number]
export type RecordStatus = (typeof RECORD_STATUS)[number]

export type Campaign = {
  id: bigint
  owner: string
  name: string
  resourceType: string
  targetQuantity: bigint
  location: string
  status: CampaignStatus
  createdAt: bigint
  reportedQuantity: bigint
  verifiedQuantity: bigint
  rejectedQuantity: bigint
  pendingCount: bigint
  approvedCount: bigint
  rejectedCount: bigint
}

export type DistRecord = {
  id: bigint
  campaignId: bigint
  submitter: string
  quantity: bigint
  location: string
  evidenceHash: string
  evidenceURI: string
  status: RecordStatus
  verifier: string
  submittedAt: bigint
  verifiedAt: bigint
}

export type CampaignView = Campaign & { records: DistRecord[] }

// The raw structs ethers returns carry the enum as a bigint.
type RawCampaign = Omit<Campaign, 'status'> & { status: bigint }
type RawRecord = Omit<DistRecord, 'status'> & { status: bigint }

function toCampaign(r: RawCampaign): Campaign {
  return {
    id: r.id,
    owner: r.owner,
    name: r.name,
    resourceType: r.resourceType,
    targetQuantity: r.targetQuantity,
    location: r.location,
    status: CAMPAIGN_STATUS[Number(r.status)],
    createdAt: r.createdAt,
    reportedQuantity: r.reportedQuantity,
    verifiedQuantity: r.verifiedQuantity,
    rejectedQuantity: r.rejectedQuantity,
    pendingCount: r.pendingCount,
    approvedCount: r.approvedCount,
    rejectedCount: r.rejectedCount,
  }
}

function toRecord(r: RawRecord): DistRecord {
  return {
    id: r.id,
    campaignId: r.campaignId,
    submitter: r.submitter,
    quantity: r.quantity,
    location: r.location,
    evidenceHash: r.evidenceHash,
    evidenceURI: r.evidenceURI,
    status: RECORD_STATUS[Number(r.status)],
    verifier: r.verifier,
    submittedAt: r.submittedAt,
    verifiedAt: r.verifiedAt,
  }
}

// Reads every campaign and its records, newest campaign first.
export async function loadAll(contract: Contract): Promise<CampaignView[]> {
  const count = Number((await contract.campaignCount()) as bigint)
  const ids = Array.from({ length: count }, (_, i) => BigInt(i + 1))

  const views = await Promise.all(
    ids.map(async (campaignId) => {
      const [rawCampaign, recordIds] = (await Promise.all([
        contract.getCampaign(campaignId),
        contract.getCampaignRecordIds(campaignId),
      ])) as [RawCampaign, bigint[]]

      const records = await Promise.all(
        recordIds.map(async (recordId) => toRecord((await contract.getRecord(recordId)) as RawRecord)),
      )
      return { ...toCampaign(rawCampaign), records }
    }),
  )

  return views.reverse()
}

// ---------------------------------------------------------------------------
// Evidence hashing
// ---------------------------------------------------------------------------

// SHA-256 of a file, as a 0x-prefixed hex string (the same form stored on-chain).
// The file never leaves the browser: only this hash is sent to the contract.
export async function sha256File(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `0x${hex}`
}

// Turns an evidence URI into a safe link. Anything that isn't http(s) or ipfs is
// shown as plain text, because the value comes from the chain and is untrusted.
export function evidenceLink(uri: string): string | null {
  const value = uri.trim()
  if (/^https?:\/\//i.test(value)) return value
  if (/^ipfs:\/\//i.test(value)) return `https://ipfs.io/ipfs/${value.slice(7)}`
  return null
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export const shorten = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`

export const formatTime = (seconds: bigint) =>
  seconds === 0n ? '—' : new Date(Number(seconds) * 1000).toLocaleString()

export const formatNumber = (value: bigint) => value.toLocaleString()

export const isPositiveInt = (value: string) => /^[1-9]\d*$/.test(value.trim())

// part / whole as a percentage with two decimals (0 when whole is 0).
export function percent(part: bigint, whole: bigint): number {
  if (whole === 0n) return 0
  return Number((part * 10000n) / whole) / 100
}

export const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const CONTRACT_ERRORS: Record<string, string> = {
  EmptyName: 'The name cannot be empty.',
  ZeroQuantity: 'The quantity must be greater than zero.',
  EmptyEvidenceHash: 'An evidence file is required.',
  CampaignNotFound: 'That campaign does not exist.',
  RecordNotFound: 'That record does not exist.',
  NotCampaignOwner: 'Only the NGO that created this campaign can do that.',
  CampaignNotActive: 'This campaign is closed.',
  RecordNotPending: 'This record has already been decided.',
  CannotVerifyOwnRecord: 'A verifier cannot verify a record they submitted themselves.',
  AccessControlUnauthorizedAccount: 'Your account does not have the role required for this action.',
}

const errorInterface = new Interface(proofOfAidAbi)

// Looks through a wallet/provider error for the raw revert data (0x…) the contract returned.
function findRevertData(value: unknown, depth = 0): string | null {
  if (depth > 5 || typeof value !== 'object' || value === null) return null
  const obj = value as Record<string, unknown>
  for (const key of ['data', 'error', 'info', 'originalError']) {
    const inner = obj[key]
    if (typeof inner === 'string' && /^0x[0-9a-fA-F]{8,}$/.test(inner)) return inner
    const found = findRevertData(inner, depth + 1)
    if (found) return found
  }
  return null
}

// Works out the name of the contract error behind a failed transaction, if there is one.
function revertName(error: object): string | null {
  const direct = (error as { revert?: { name?: string } | null }).revert?.name
  if (direct) return direct

  let data = findRevertData(error)
  if (!data) {
    // Some providers only put the data inside the message text.
    const message = (error as { message?: string }).message ?? ''
    data = /(?:data|return data)[:=]\s*"?(0x[0-9a-fA-F]{8,})/.exec(message)?.[1] ?? null
  }
  if (!data) return null

  try {
    return errorInterface.parseError(data)?.name ?? null
  } catch {
    return null
  }
}

export function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const e = error as { code?: number | string; shortMessage?: string; message?: string }
    if (e.code === 4001 || e.code === 'ACTION_REJECTED') return 'Request cancelled in the wallet.'
    const name = revertName(error)
    if (name && CONTRACT_ERRORS[name]) return CONTRACT_ERRORS[name]
    return e.shortMessage ?? e.message ?? 'Something went wrong.'
  }
  return 'Something went wrong.'
}
