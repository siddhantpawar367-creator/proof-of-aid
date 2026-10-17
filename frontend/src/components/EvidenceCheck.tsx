import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { sha256File } from '../chain'

type Result = { fileName: string; hash: string; match: boolean }

// Lets anyone pick a file and compare its SHA-256 hash with the one recorded on-chain.
export function EvidenceCheck({ expectedHash }: { expectedHash: string }) {
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) {
      setResult(null)
      return
    }
    setBusy(true)
    try {
      const hash = await sha256File(file)
      setResult({
        fileName: file.name,
        hash,
        match: hash.toLowerCase() === expectedHash.toLowerCase(),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="evidence-check">
      <label className="file-label">
        Check a file against the recorded hash
        <input type="file" onChange={onFile} />
      </label>

      {busy && <p className="muted">Calculating hash…</p>}

      {result && (
        <div className={result.match ? 'check-result check-ok' : 'check-result check-bad'}>
          <strong>
            {result.match
              ? 'Match: this file is identical to the evidence recorded.'
              : 'Mismatch: this file differs from the evidence recorded.'}
          </strong>
          <p className="mono small">
            {result.fileName}
            <br />
            {result.hash}
          </p>
          <p className="muted small">
            This shows whether the file was changed. It does not prove the contents are true.
          </p>
        </div>
      )}
    </div>
  )
}
