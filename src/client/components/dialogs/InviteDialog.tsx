import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from '../Icons.tsx';
import { Segmented } from '../ui/Controls.tsx';
import { Modal } from '../ui/Modal.tsx';

interface ShareUrl {
  url: string;
  kind: 'lan' | 'vpn';
}

const onThisComputer = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

async function copyText(text: string, fallback: HTMLInputElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // The Clipboard API needs HTTPS or localhost; on a plain-http network address select the text instead.
    fallback?.select();
    return document.execCommand?.('copy') ?? false;
  }
}

export function InviteDialog({ open, onClose, gameId }: { open: boolean; onClose: () => void; gameId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  // When the host opened the app on localhost, colleagues need this computer's network address.
  const [network, setNetwork] = useState<ShareUrl[] | null>(onThisComputer ? null : []);
  const [choice, setChoice] = useState(0);

  useEffect(() => {
    if (!open) {
      setCopied(false);
      return;
    }
    if (!onThisComputer) return;
    let cancelled = false;
    fetch('/api/network')
      .then((res) => (res.ok ? (res.json() as Promise<{ urls?: ShareUrl[] }>) : { urls: [] }))
      .then((body) => !cancelled && setNetwork(body.urls ?? []))
      .catch(() => !cancelled && setNetwork([]));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const shared = network?.[choice] ?? network?.[0];
  const url = `${shared ? shared.url : window.location.origin}/${gameId}`;
  const kindLabel = (entry: ShareUrl) => (entry.kind === 'vpn' ? 'VPN' : 'Local network');
  const ambiguous = new Set(network?.map(kindLabel)).size !== (network?.length ?? 0);

  const copy = async () => {
    if (await copyText(url, inputRef.current)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Invite players" size="sm">
      <p className="muted">Share this link with your team. Anyone with the link can join the game.</p>
      {network && network.length > 1 && (
        <Segmented
          label="Network"
          value={String(choice)}
          onChange={(value) => setChoice(Number(value))}
          options={network.map((entry, index) => ({
            value: String(index),
            label: ambiguous ? `${kindLabel(entry)} · ${new URL(entry.url).hostname}` : kindLabel(entry),
          }))}
        />
      )}
      <div className="field">
        <label className="field-label" htmlFor="invite-url">
          Game's URL
        </label>
        <input id="invite-url" ref={inputRef} className="input input-mono" value={url} readOnly onFocus={(event) => event.target.select()} />
      </div>
      {onThisComputer && shared && (
        <p className="field-hint">
          You are hosting this game on your computer. Colleagues on the same {shared.kind === 'vpn' ? 'VPN' : 'network (office LAN/Wi-Fi)'} can open
          this link while the app keeps running.
        </p>
      )}
      {onThisComputer && network?.length === 0 && (
        <p className="notice">
          This link only works on this computer. To invite colleagues, start the app with <code>./run.sh</code> (it listens on your network), or deploy it.
        </p>
      )}
      <button type="button" className="btn btn-primary btn-block" onClick={copy} data-autofocus disabled={onThisComputer && network === null}>
        {copied ? <Check size={18} /> : <Copy size={18} />}
        {copied ? 'Link copied!' : 'Copy invitation link'}
      </button>
    </Modal>
  );
}
