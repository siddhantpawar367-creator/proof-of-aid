import { useState } from 'react'
import type { FormEvent } from 'react'
import { isAddress } from 'ethers'
import type { RunTx } from '../chain'
import { NGO_ROLE, VERIFIER_ROLE } from '../chain'

type Props = {
  canWrite: boolean
  runTx: RunTx
}

// Lets the admin authorize NGO and verifier wallets.
export function AdminPanel({ canWrite, runTx }: Props) {
  const [address, setAddress] = useState('')
  const [role, setRole] = useState<'ngo' | 'verifier'>('ngo')
  const [formError, setFormError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const wallet = address.trim()
    if (!isAddress(wallet)) return setFormError('Enter a valid wallet address (starts with 0x).')
    setFormError(null)

    const ok = await runTx(role === 'ngo' ? 'Granting NGO role' : 'Granting verifier role', (c) =>
      c.grantRole(role === 'ngo' ? NGO_ROLE : VERIFIER_ROLE, wallet),
    )
    if (ok) setAddress('')
  }

  return (
    <section className="card">
      <h2>Admin tools</h2>
      <p className="muted">Authorize an NGO or a verifier by wallet address.</p>

      {formError && (
        <div className="notice notice-error" role="alert">
          {formError}
        </div>
      )}

      <form onSubmit={onSubmit} className="form">
        <label>
          Wallet address
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" />
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value as 'ngo' | 'verifier')}>
            <option value="ngo">NGO</option>
            <option value="verifier">Verifier</option>
          </select>
        </label>
        <button type="submit" disabled={!canWrite}>
          Grant role
        </button>
      </form>
    </section>
  )
}
