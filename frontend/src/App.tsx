import { useCallback, useEffect, useState } from 'react'
import { BrowserProvider, Contract, JsonRpcProvider, ZeroHash, id } from 'ethers'
import { proofOfAidAbi } from './abi'
import {
  CONTRACT_ADDRESS,
  ETHERSCAN_BASE,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_CHAIN_ID_HEX,
  SEPOLIA_RPC,
} from './config'

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

type Roles = { admin: boolean; ngo: boolean; verifier: boolean }
type Stats = { campaigns: bigint; records: bigint }

// Reads go through a public RPC so the data is visible without a wallet.
const readProvider = new JsonRpcProvider(SEPOLIA_RPC, SEPOLIA_CHAIN_ID, { staticNetwork: true })
const readContract = new Contract(CONTRACT_ADDRESS, proofOfAidAbi, readProvider)

// Role ids are the same hashes the contract uses (keccak256 of the role name).
const ADMIN_ROLE = ZeroHash // DEFAULT_ADMIN_ROLE is bytes32(0)
const NGO_ROLE = id('NGO_ROLE')
const VERIFIER_ROLE = id('VERIFIER_ROLE')

const shorten = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const e = error as { code?: number | string; shortMessage?: string; message?: string }
    if (e.code === 4001 || e.code === 'ACTION_REJECTED') return 'Request cancelled in the wallet.'
    return e.shortMessage ?? e.message ?? 'Something went wrong.'
  }
  return 'Something went wrong.'
}

function App() {
  const [account, setAccount] = useState<string | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)
  const [roles, setRoles] = useState<Roles | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)

  const hasWallet = typeof window !== 'undefined' && Boolean(window.ethereum)

  // Read the current wallet account and network (no popup).
  const refreshWallet = useCallback(async () => {
    if (!window.ethereum) return
    try {
      const provider = new BrowserProvider(window.ethereum)
      const accounts = (await provider.send('eth_accounts', [])) as string[]
      const network = await provider.getNetwork()
      setChainId(Number(network.chainId))
      setAccount(accounts[0] ?? null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])

  // Load the on-chain counters for the public view.
  const refreshStats = useCallback(async () => {
    try {
      const [campaigns, records] = (await Promise.all([
        readContract.campaignCount(),
        readContract.recordCount(),
      ])) as [bigint, bigint]
      setStats({ campaigns, records })
    } catch (e) {
      setError(`Could not read the contract: ${errorMessage(e)}`)
    }
  }, [])

  useEffect(() => {
    void refreshWallet()
    void refreshStats()

    const eth = window.ethereum
    if (!eth) return
    const onChange = () => void refreshWallet()
    eth.on('accountsChanged', onChange)
    eth.on('chainChanged', onChange)
    return () => {
      eth.removeListener('accountsChanged', onChange)
      eth.removeListener('chainChanged', onChange)
    }
  }, [refreshWallet, refreshStats])

  // Work out which roles the connected account holds.
  useEffect(() => {
    if (!account) {
      setRoles(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const [admin, ngo, verifier] = (await Promise.all([
          readContract.hasRole(ADMIN_ROLE, account),
          readContract.hasRole(NGO_ROLE, account),
          readContract.hasRole(VERIFIER_ROLE, account),
        ])) as [boolean, boolean, boolean]
        if (!cancelled) setRoles({ admin, ngo, verifier })
      } catch (e) {
        if (!cancelled) setError(`Could not read roles: ${errorMessage(e)}`)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [account])

  async function connectWallet() {
    if (!window.ethereum) return
    setError(null)
    try {
      await new BrowserProvider(window.ethereum).send('eth_requestAccounts', [])
      await refreshWallet()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  async function switchToSepolia() {
    if (!window.ethereum) return
    setError(null)
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
      })
      await refreshWallet()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const wrongNetwork = account !== null && chainId !== SEPOLIA_CHAIN_ID

  return (
    <main className="page">
      <header className="header">
        <h1>Proof of Aid</h1>
        <p className="tagline">Making Every Aid Delivery Accountable.</p>
      </header>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      <section className="card">
        <h2>Wallet</h2>

        {!hasWallet && (
          <p>
            No wallet found. Install <a href="https://metamask.io/download/">MetaMask</a> and
            reload this page.
          </p>
        )}

        {hasWallet && !account && (
          <>
            <p>Connect your wallet to see your role.</p>
            <button onClick={connectWallet}>Connect MetaMask</button>
          </>
        )}

        {account && (
          <>
            <p className="mono">{shorten(account)}</p>

            {wrongNetwork ? (
              <div className="notice">
                <p>Your wallet is on the wrong network. Proof of Aid runs on Sepolia.</p>
                <button onClick={switchToSepolia}>Switch to Sepolia</button>
              </div>
            ) : (
              <p className="muted">Connected to Sepolia</p>
            )}

            <div className="badges">
              {roles === null && <span className="badge">Checking role…</span>}
              {roles?.admin && <span className="badge badge-admin">Admin</span>}
              {roles?.ngo && <span className="badge badge-ngo">NGO</span>}
              {roles?.verifier && <span className="badge badge-verifier">Verifier</span>}
              {roles && !roles.admin && !roles.ngo && !roles.verifier && (
                <span className="badge">Public viewer</span>
              )}
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2>On-chain data</h2>
        <dl className="stats">
          <div>
            <dt>Campaigns</dt>
            <dd>{stats ? stats.campaigns.toString() : '…'}</dd>
          </div>
          <div>
            <dt>Distribution records</dt>
            <dd>{stats ? stats.records.toString() : '…'}</dd>
          </div>
        </dl>
        <p className="muted">
          Contract{' '}
          <a href={`${ETHERSCAN_BASE}/address/${CONTRACT_ADDRESS}`} className="mono">
            {shorten(CONTRACT_ADDRESS)}
          </a>{' '}
          on Sepolia
        </p>
      </section>
    </main>
  )
}

export default App
