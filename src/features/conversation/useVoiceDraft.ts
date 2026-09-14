'use client';

import { useEffect, useRef, useState } from 'react';
import { startVoiceCapture, type VoiceCapture } from './voiceCapture';
import { MAX_DRAFT_LENGTH } from '@/shared/voice';

export function useVoiceDraft(enabled: boolean) {
  const [status, setStatus] = useState('Ready to dictate');
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'transcribing'>('idle');
  const [result, setResult] = useState('');
  const [activity, setActivity] = useState({ level: 0, seconds: 0 });
  const [language, setLanguage] = useState('en');
  const [configured, setConfigured] = useState(false);
  const [retry, setRetry] = useState(0);
  const operation = useRef<{ controller: AbortController; capture?: VoiceCapture; stopping?: boolean }>(undefined);
  const available = useRef(enabled);
  available.current = enabled;

  const discard = () => {
    operation.current?.controller.abort();
    operation.current = undefined;
    setPhase('idle'); setResult(''); setStatus('Draft preserved');
    setActivity({ level: 0, seconds: 0 });
  };
  useEffect(() => {
    if (!enabled) { discard(); return; }
    setConfigured(false);
    setStatus('Checking voice on the home machine…');
    const controller = new AbortController();
    void fetch('/api/voice', { signal: controller.signal, cache: 'no-store' }).then(async (response) => {
      const data = await response.json() as { configured?: boolean; language?: string };
      if (controller.signal.aborted) return;
      setConfigured(response.ok && data.configured === true);
      setLanguage(data.language || 'en');
      setStatus(response.ok && data.configured
        ? 'Ready to dictate'
        : 'Voice unavailable · set up local Whisper on the home machine (README)');
    }).catch(() => { if (!controller.signal.aborted) setStatus('Voice unavailable · check the home connection and reopen Compose'); });
    return () => { controller.abort(); operation.current?.controller.abort(); operation.current = undefined; };
  }, [enabled, retry]);

  const stop = async () => {
    const current = operation.current;
    if (!current?.capture || current.stopping) return;
    current.stopping = true;
    setPhase('transcribing'); setStatus('Transcribing…');
    try {
      const wav = await current.capture.stop();
      if (current.controller.signal.aborted) return;
      setStatus('Transcribing…');
      const response = await fetch('/api/voice', {
        method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav,
        signal: AbortSignal.any([current.controller.signal, AbortSignal.timeout(100_000)]),
      });
      const data = await response.json() as { text?: string; error?: string };
      if (!response.ok) throw new Error(data.error || 'Transcription failed. Retry dictation.');
      if (typeof data.text !== 'string' || data.text.length > MAX_DRAFT_LENGTH) throw new Error('Invalid transcription response. Retry dictation.');
      if (current.controller.signal.aborted || operation.current !== current) return;
      setResult(data.text);
      setStatus(data.text ? 'Review your words, then add them to the message' : 'No speech recognized · retry dictation');
    } catch (error) {
      if (!current.controller.signal.aborted && operation.current === current) setStatus(error instanceof Error ? error.message : 'Voice failed. Retry dictation.');
    } finally {
      current.controller.abort();
      if (operation.current === current) { operation.current = undefined; setPhase('idle'); }
    }
  };
  const start = async () => {
    if (!available.current || !configured || operation.current) return;
    const current = { controller: new AbortController(), capture: undefined as VoiceCapture | undefined };
    operation.current = current;
    setResult(''); setActivity({ level: 0, seconds: 0 }); setPhase('starting'); setStatus('Allow microphone access in the headset');
    try {
      current.capture = await startVoiceCapture(current.controller.signal, (error) => {
        if (operation.current !== current) return;
        if (!error) { void stop(); return; }
        current.controller.abort(); operation.current = undefined;
        setPhase('idle'); setStatus(error);
      }, (level, seconds) => {
        if (operation.current === current && !current.controller.signal.aborted) setActivity({ level, seconds });
      });
      if (current.controller.signal.aborted || operation.current !== current) return;
      setPhase('recording'); setStatus(`Listening · ${language} · words appear after Stop`);
    } catch (error) {
      if (operation.current !== current) return;
      current.controller.abort(); operation.current = undefined; setPhase('idle');
      setStatus(error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Microphone denied · allow microphone access for CodeAI in browser settings, then retry'
        : error instanceof Error ? error.message : 'Microphone unavailable. Retry dictation.');
    }
  };
  return { status, phase, result, activity, configured, start, stop, discard, replaceResult: setResult,
    retry: () => setRetry((value) => value + 1),
    clearResult: () => { setResult(''); setStatus('Ready to send'); } };
}
