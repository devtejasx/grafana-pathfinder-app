/**
 * Installing a Grafana credential into a sandbox VM, so the `gcx` CLI that
 * ships in every image can talk to this Grafana as the learner.
 *
 * Lives in `integrations/` because `TerminalPanel` (tier 3) cannot import from
 * `components/` (tier 4), while `terminal-connect-step` (tier 4) can import
 * from here.
 *
 * State lives in `gcx-credential-store`, not in the component, so the guide
 * step and the terminal toolbar agree on whether this session already has a
 * credential. See `docs/developer/CODA.md` for why minting happens in the
 * browser and why a pasted token is the primary path, not a fallback.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useSyncExternalStore } from 'react';

import { canMintGrafanaToken, type GcxCredential } from './coda-api';
import {
  getGcxCredentialSnapshot,
  resetGcxCredential,
  runGcxCredential,
  subscribeGcxCredential,
  type GcxState,
} from './gcx-credential-store';

export type { GcxState };

export interface UseGcxCredentialResult {
  state: GcxState;
  credential: GcxCredential | null;
  error: string | null;
  /** Whether a mint has yet to be tried or refused for this session. */
  offerMint: boolean;
  /** A role hint for how prominently to offer minting, not an authorisation answer. */
  mintLikely: boolean;
  /** True until a credential is installed — callers gate completion on this. */
  isPending: boolean;
  run: (sessionId: string | null, token?: string) => Promise<void>;
  reset: () => void;
}

/**
 * @param onReady called once per credential installed into `sessionId` by a
 *   `run` from this same caller. A gcx step uses it to mark itself complete; the
 *   terminal toolbar has nothing to do and omits it. An install another surface
 *   made still shows up in `state` and `credential`, but does not call it: every
 *   mounted step names the one live session, so completing on any install would
 *   tick off a step whose own setup never ran.
 * @param sessionId the session this caller is asking about. Everything the hook
 *   reports describes that session and nothing else: a credential belongs to
 *   the VM it was written into, so an unrelated step must not read one, render
 *   it, or complete on it.
 */
export function useGcxCredential(
  onReady?: (credential: GcxCredential) => void,
  sessionId: string | null = null
): UseGcxCredentialResult {
  const requester = useId();
  const stored = useSyncExternalStore(subscribeGcxCredential, getGcxCredentialSnapshot);
  const snapshot = useMemo(
    () =>
      stored.sessionId === sessionId
        ? stored
        : { sessionId, requester: null, state: 'idle' as GcxState, credential: null, error: null },
    [stored, sessionId]
  );

  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  const notifiedRef = useRef<GcxCredential | null>(null);
  useEffect(() => {
    if (
      snapshot.state !== 'ready' ||
      !snapshot.credential ||
      snapshot.requester !== requester ||
      notifiedRef.current === snapshot.credential
    ) {
      return;
    }
    notifiedRef.current = snapshot.credential;
    onReadyRef.current?.(snapshot.credential);
  }, [snapshot.state, snapshot.credential, snapshot.requester, requester]);

  const run = useCallback(
    (target: string | null, token?: string) => runGcxCredential(target, token, requester),
    [requester]
  );
  const reset = useCallback(() => resetGcxCredential(), []);

  return {
    state: snapshot.state,
    credential: snapshot.credential,
    error: snapshot.error,
    offerMint: snapshot.state === 'idle',
    mintLikely: canMintGrafanaToken(),
    isPending: snapshot.state !== 'ready',
    run,
    reset,
  };
}
