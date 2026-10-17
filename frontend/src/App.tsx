import { useCallback, useEffect, useState } from 'react'
import { BrowserProvider } from 'ethers'
import type { Contract } from 'ethers'
import {
  CONTRACT_ADDRESS,
  ETHERSCAN_BASE,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_CHAIN_ID_HEX,
} from './config'
import { errorMessage, getWriteContract, loadAll, loadRoles, readContract, shorten } from './chain'
import type { CampaignView, Roles, RunTx } from './chain'
import { AdminPanel } from './components/AdminPanel'
import { CampaignList } from './components/CampaignList'
import { NgoPanel } from './components/NgoPanel'
import { VerifierPanel } from './components/VerifierPanel'

function App() {
  const [account, setAccount] = useState<string | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)
  const [roles, setRoles] = useState<Roles | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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

  // Load every campaign and record. Reads use the public RPC unless a contract is passed in.
  const refreshData = useCallback(async (contract: Contract = readContract) => {
    try {
      setCampaigns(await loadAll(contract))
    } catch (e) {
      setError(`Could not read the contract: ${errorMessage(e)}`)
    }
  }, [])

  useEffect(() => {
    void refreshWallet()
    void refreshData()

    const eth = window.ethereum
    if (!eth) return
    const onChange = () => void refreshWallet()
    eth.on('accountsChanged', onChange)
    eth.on('chainChanged', onChange)
    return () => {
      eth.removeListener('accountsChanged', onChange)
      eth.removeListener('chainChanged', onChange)
    }
  }, [refreshWallet, refreshData])

  // Work out which roles the connected account holds.
  useEffect(() => {
    if (!account) {
      setRoles(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const found = await loadRoles(readContract, account)
        if (!cancelled) setRoles(found)
      } catch (e) {
        if (!cancelled) setError(`Could not read roles: ${errorMessage(e)}`)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [account])

  // Sends one transaction through the wallet, waits for it, then reloads the data.
  const runTx = useCallback<RunTx>(
    async (label, send) => {
      setError(null)
      setBusy(true)
      setStatus(`${label}: confirm in MetaMask…`)
      try {
        const contract = await getWriteContract()
        const tx = await send(contract)
        setStatus(`${label}: waiting for the network to confirm…`)
        await tx.wait()
        // Read back through the wallet's own connection so the new block is always visible.
        await refreshData(contract)
        if (account) setRoles(await loadRoles(contract, account))
        setStatus(`${label}: done.`)
        return true
      } catch (e) {
        setStatus(null)
        setError(errorMessage(e))
        return false
      } finally {
        setBusy(false)
      }
    },
    [refreshData, account],
  )

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
  const canWrite = account !== null && !wrongNetwork && !busy

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

      {status && (
        <div className="notice notice-ok" role="status">
          {status}
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
            <p>Connect your wallet to see your role and use the tools for it.</p>
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

      {account && roles?.admin && <AdminPanel canWrite={canWrite} runTx={runTx} />}

      {account && roles?.ngo && (
        <NgoPanel account={account} campaigns={campaigns ?? []} canWrite={canWrite} runTx={runTx} />
      )}

      {account && roles?.verifier && (
        <VerifierPanel
          account={account}
          campaigns={campaigns ?? []}
          canWrite={canWrite}
          runTx={runTx}
        />
      )}

      <div className="section-head">
        <h2>Campaigns</h2>
        <button className="button-secondary" onClick={() => void refreshData()}>
          Refresh
        </button>
      </div>
      <p className="muted small">
        Figures are labelled by what has actually been established: <strong>reported</strong> is
        what the NGO claims, <strong>verified</strong> is what an independent verifier accepted
        after reviewing the evidence. Verified does not prove a delivery physically happened.
      </p>

      <CampaignList campaigns={campaigns} />

      <footer className="footer muted small">
        Contract{' '}
        <a href={`${ETHERSCAN_BASE}/address/${CONTRACT_ADDRESS}`} className="mono">
          {shorten(CONTRACT_ADDRESS)}
        </a>{' '}
        on the Sepolia test network
      </footer>
    </main>
  )
}

export default App
