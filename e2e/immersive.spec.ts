import type { RootState } from '@react-three/fiber';
import type { XRStore } from '@react-three/xr';
import type { Mesh } from 'three';
import { expect, test, type Page } from '@playwright/test';
import type { ArenaMachineSnapshot, DurableProject, PublicSession } from '../src/shared/types';
import { validVoiceWav } from '../src/shared/voice';

test.use({ launchOptions: { args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

const conversationAction = (page: Page, action: string) => controls(page).locator(`[data-immersive-action="conversation:${action}"]`).click();
const conversationState = (page: Page) => page.evaluate(() => window.xrScene?.scene.getObjectByName('Conversation tools')?.userData);

test.describe('VR conversation input', () => {

  async function setupVoice(page: Page) {
    await installAdapter(page);
    await workspaceFixture(page, true);
    await page.route('**/api/health', (route) => route.fulfill({ json: {
      ok: true, hostLabel: 'Home', repositoriesRootReady: true, dataDirectoryReady: true,
      providers: { claude: { available: true, authenticated: true, supportedModes: ['ask', 'plan'] },
        codex: { available: false, authenticated: 'unknown', supportedModes: [] } },
    } }));
    const voice = { text: 'Edit badpath', requests: 0, fail: false, pending: undefined as Promise<void> | undefined };
    await page.route('**/api/voice', async (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { configured: true, language: 'en' } });
      voice.requests++;
      expect(validVoiceWav(route.request().postDataBuffer()!)).toBe(true);
      await voice.pending;
      return route.fulfill(voice.fail ? { status: 503, json: { error: 'Transcription unavailable. Retry dictation.' } } : { json: { text: voice.text } });
    });
    await page.addInitScript(() => {
      const tracks: MediaStreamTrack[] = [];
      Object.assign(window, { voiceTestTracks: tracks });
      const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await capture(constraints);
        tracks.push(...stream.getTracks());
        return stream;
      };
    });
    await page.goto('/'); await enter(page);
    await conversationAction(page, 'compose');
    await expect.poll(async () => (await conversationState(page))?.conversationTab).toBe('compose');
    return voice;
  }

  async function dictate(page: Page) {
    await expect.poll(() => page.evaluate(() => window.xrScene?.scene.getObjectByName('Dictate')?.userData.disabled)).toBe(false);
    await conversationAction(page, 'record');
    await expect.poll(async () => (await conversationState(page))?.voicePhase).toBe('recording');
    // Let the real AudioWorklet capture a nonempty fake microphone clip.
    await page.waitForTimeout(180);
    await conversationAction(page, 'stop');
    await expect.poll(async () => (await conversationState(page))?.voicePhase).toBe('idle');
  }
  async function microphoneReleased(page: Page) {
    await expect.poll(() => page.evaluate(() =>
      window.voiceTestTracks.every((track) => track.readyState === 'ended'),
    )).toBe(true);
  }

  test('types in the inline field, preserves the draft across header views, and sends explicitly once', async ({ page }) => {
    await setupVoice(page);
    const input = page.locator('[data-immersive-message-input]');
    await expect(input).toHaveCount(1);
    expect(await page.evaluate(() => Boolean(window.xrScene?.scene.getObjectByName('VR chat messages')))).toBe(true);
    const header = await page.evaluate(() => ['Conversation history', 'Agents'].map((name) => window.xrScene!.scene.getObjectByName(name)!.parent!.parent!.position.toArray()));
    expect(header).toEqual([[0.38, 0.81, 0], [0.56, 0.81, 0]]);
    expect(await page.evaluate(() => {
      const mesh = window.xrScene!.scene.getObjectByName('Message input') as Mesh;
      mesh.geometry.computeBoundingBox();
      return { position: mesh.position.toArray(), width: mesh.geometry.boundingBox!.max.x - mesh.geometry.boundingBox!.min.x };
    })).toMatchObject({ position: [0, -0.66, 0.0015], width: expect.closeTo(1.32, 5) });
    expect(await page.evaluate(() => {
      const scene = window.xrScene!.scene;
      const panel = scene.getObjectByName('Conversation panel')!;
      scene.updateMatrixWorld(true);
      const bounds = (name: string) => {
        const mesh = scene.getObjectByName(name) as Mesh;
        mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox!;
        const points = [box.min.x, box.max.x].flatMap((x) => [box.min.y, box.max.y].flatMap((y) =>
          [box.min.z, box.max.z].map((z) => panel.worldToLocal(mesh.localToWorld(window.xrScene!.camera.position.clone().set(x, y, z))))));
        return { minY: Math.min(...points.map((point) => point.y)), maxY: Math.max(...points.map((point) => point.y)),
          z: panel.worldToLocal(mesh.getWorldPosition(window.xrScene!.camera.position.clone())).z };
      };
      const status = bounds('Voice status');
      const input = bounds('Message input');
      const inspect = (name: string) => {
        const mesh = scene.getObjectByName(name) as Mesh;
        return { z: bounds(name).z, renderOrder: mesh.renderOrder,
          transparent: (mesh.material as import('three').Material).transparent };
      };
      return {
        statusInputGap: status.minY - input.maxY,
        title: inspect('Focus Conversation display'),
        headerBackground: inspect('Conversation history background'),
        headerGlyph: inspect('Conversation history'),
        status: inspect('Voice status'), input: inspect('Message input'),
        dictateBackground: inspect('Dictate background'), dictateGlyph: inspect('Dictate'),
        sendBackground: inspect('Send background'),
      };
    })).toMatchObject({
      statusInputGap: expect.closeTo(0.0136, 3),
      title: { z: expect.closeTo(0.003, 5), renderOrder: 4, transparent: true },
      headerBackground: { z: expect.closeTo(0.0065, 5), renderOrder: 20, transparent: true },
      headerGlyph: { z: expect.closeTo(0.007, 5), renderOrder: 21, transparent: true },
      status: { z: expect.closeTo(0.0035, 5), renderOrder: 12, transparent: true },
      input: { z: expect.closeTo(0.0045, 5), renderOrder: 14, transparent: true },
      dictateBackground: { z: expect.closeTo(0.0065, 5), renderOrder: 20, transparent: true },
      dictateGlyph: { z: expect.closeTo(0.007, 5), renderOrder: 21, transparent: true },
      sendBackground: { z: expect.closeTo(0.0065, 5), renderOrder: 20, transparent: true },
    });
    expect(JSON.parse((await panel(page, 'conversation').getAttribute('data-layout'))!).angle).toBe(36);
    await pointAtAction(page, 'message-input');
    await page.mouse.down(); await page.mouse.up();
    await expect(input).toBeFocused();
    await page.keyboard.insertText('Review src/App.tsx');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('Keep the tests.');
    const draft = 'Review src/App.tsx\nKeep the tests.';
    await expect.poll(async () => (await conversationState(page))?.draft).toBe(draft);
    await page.screenshot({ path: 'test-results/vr-inline-input.png' });
    await pointAtAction(page, 'conversation:clear');
    await page.mouse.down(); await page.mouse.up();
    await expect.poll(async () => (await conversationState(page))?.draft).toBe('');
    await expect(input).not.toBeFocused();
    await expect.poll(() => page.evaluate(() => Boolean(window.xrScene?.scene.getObjectByName('Clear draft')))).toBe(false);
    await pointAtAction(page, 'message-input');
    await page.mouse.down(); await page.mouse.up();
    await page.keyboard.insertText('Write a new message.');
    await page.keyboard.press('Escape');
    const replacementDraft = 'Write a new message.';
    await expect.poll(async () => (await conversationState(page))?.draft).toBe(replacementDraft);
    await hideProjection(page);
    await conversationAction(page, 'list');
    await expect(input).toHaveCount(0);
    await conversationAction(page, 'back');
    await expect(input).toHaveValue(replacementDraft);
    await conversationAction(page, 'agents');
    await expect(input).toHaveCount(0);
    await conversationAction(page, 'agents');
    await expect(input).toHaveValue(replacementDraft);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const sent: Array<{ text: string; sessionId: string; participantId: string }> = [];
    await page.route('**/api/agent/message', async (route) => {
      sent.push(route.request().postDataJSON()); await pending;
      await route.fulfill({ status: 503, json: { error: 'Temporary failure' } });
    });
    await page.evaluate(() => {
      const send = document.querySelector<HTMLButtonElement>('[data-immersive-action="conversation:send"]')!;
      send.click(); send.click();
    });
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ text: replacementDraft, sessionId: SESSION, participantId: AGENT });
    release();
    await expect(input).toHaveValue(replacementDraft);
    await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click();
    await expect(input).toHaveCount(0); await released(page);
  });

  test('edits an existing draft through the guarded native Quest keyboard buffer', async ({ page }) => {
    await setupVoice(page);
    const input = page.locator('[data-immersive-message-input]');
    await pointAtAction(page, 'message-input');
    await page.mouse.down(); await page.mouse.up();
    await page.keyboard.insertText('Keep this draft.');
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const { gl, scene } = window.xrScene!;
      const original = gl.xr.getSession;
      scene.userData.restoreKeyboardSession = () => { gl.xr.getSession = original; };
      gl.xr.getSession = () => ({ isSystemKeyboardSupported: true }) as unknown as XRSession;
    });
    const end = await page.evaluate(() => {
      const context = document.createElement('canvas').getContext('2d')!;
      const family = getComputedStyle(document.documentElement).getPropertyValue('--font-inter').trim() || 'system-ui';
      const size = Math.round(2 * 2.6 * Math.tan((18 * 0.0625 * Math.PI / 180) / 2) * 1024 / 1.32);
      context.font = `400 ${size}px ${family}, system-ui, sans-serif`;
      return [((28 + context.measureText('Keep this draft.').width) / 1024 - 0.5) * 1.32, (0.5 - 45 / 256) * 0.30, 0];
    });
    await pointAtAction(page, 'message-input', end);
    await page.mouse.down(); await page.waitForTimeout(450); await page.mouse.up();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('\u2060');
    const nativeInput = (value: string, inputType: string, caret = value.length) => input.evaluate(
      (element: HTMLTextAreaElement, change) => {
        element.value = change.value;
        element.setSelectionRange(change.caret, change.caret);
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: change.inputType }));
      }, { value, inputType, caret },
    );
    // The invisible guard turns Backspace on an otherwise empty native buffer into
    // an observable value change, while the remembered VR caret edits the real draft.
    await nativeInput('', 'deleteContentBackward', 0);
    await expect.poll(async () => (await conversationState(page))?.draft).toBe('Keep this draft');
    await expect(input).toHaveValue('\u2060');
    await nativeInput('', 'deleteContentBackward', 0);
    await expect.poll(async () => (await conversationState(page))?.draft).toBe('Keep this draf');
    await nativeInput('!', 'insertText');
    await expect.poll(async () => (await conversationState(page))?.draft).toBe('Keep this draf!');
    // Native correction, prediction, or speech may replace the complete native buffer.
    await nativeInput(' better', 'insertReplacementText');
    await expect.poll(async () => (await conversationState(page))?.draft).toBe('Keep this draf better');
    await input.evaluate((element: HTMLTextAreaElement) => element.blur());
    await expect(input).toHaveValue('Keep this draf better');
    const afterKeep = await page.evaluate(() => {
      const context = document.createElement('canvas').getContext('2d')!;
      const family = getComputedStyle(document.documentElement).getPropertyValue('--font-inter').trim() || 'system-ui';
      const size = Math.round(2 * 2.6 * Math.tan((18 * 0.0625 * Math.PI / 180) / 2) * 1024 / 1.32);
      context.font = `400 ${size}px ${family}, system-ui, sans-serif`;
      return [((28 + context.measureText('Keep').width) / 1024 - 0.5) * 1.32, (0.5 - 45 / 256) * 0.30, 0];
    });
    await pointAtAction(page, 'message-input', afterKeep);
    await page.mouse.down(); await page.mouse.up();
    await expect(input).toHaveValue('\u2060');
    await nativeInput(', definitely,', 'insertFromDictation');
    await expect.poll(async () => (await conversationState(page))?.draft).toBe('Keep, definitely, this draf better');
    expect(await page.evaluate(() => Boolean(window.xrScene?.scene.getObjectByName('Edit message')))).toBe(false);
    expect(await page.evaluate(() => Boolean(window.xrScene?.scene.getObjectByName('Message keyboard')))).toBe(false);
    expect(await page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__!.logicalTexturePixels)).toBeLessThanOrEqual(5_592_405);
    await input.evaluate((element: HTMLTextAreaElement) => element.blur());
    await page.evaluate(() => { window.xrScene!.scene.userData.restoreKeyboardSession(); delete window.xrScene!.scene.userData.restoreKeyboardSession; });
    await expect.poll(() => page.evaluate(() => window.xrScene?.scene.getObjectByName('VR chat messages')?.visible)).toBe(true);
    await pointAtAction(page, 'panel:conversation:toggle');
    await page.mouse.down(); await page.mouse.up();
    await expect.poll(() => livePanelIds(page)).toEqual(['canvas']);
    await expect(input).toHaveCount(0);
    await pointAtAction(page, 'panel:conversation:toggle');
    await page.mouse.down(); await page.mouse.up();
    await expect.poll(() => livePanelIds(page)).toEqual(['canvas', 'conversation']);
    await expect(input).toHaveValue('Keep, definitely, this draf better');
    await hideProjection(page);
    await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click(); await released(page);
  });

  test('dictates, spells a path, sends once, and preserves a failed draft across navigation', async ({ page }) => {
    const voice = await setupVoice(page);
    // Exercise a real ray selection, then use the same registered actions for the longer workflow.
    await pointAtAction(page, 'conversation:record');
    await page.mouse.down(); await page.mouse.up();
    await hideProjection(page);
    await expect.poll(async () => (await conversationState(page))?.voicePhase).toBe('recording');
    await page.waitForTimeout(180);
    await conversationAction(page, 'stop');
    await expect.poll(async () => (await conversationState(page))?.voiceResult).toBe('Edit badpath');
    await conversationAction(page, 'edit');
    await conversationAction(page, 'append');
    await expect.poll(async () => (await conversationState(page))?.draft).toBe('Edit badpath');
    expect(await page.evaluate(() => {
      const scene = window.xrScene!.scene;
      const panel = scene.getObjectByName('Conversation panel')!;
      scene.updateMatrixWorld(true);
      return ['Voice help', 'Clear draft', 'Done'].map((name) => {
        const mesh = scene.getObjectByName(name) as Mesh;
        mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox!;
        const xs = [box.min.x, box.max.x].map((x) => panel.worldToLocal(mesh.localToWorld(
          window.xrScene!.camera.position.clone().set(x, 0, 0),
        )).x);
        return { name, min: Math.min(...xs), max: Math.max(...xs) };
      }).sort((left, right) => left.min - right.min)
        .every((item, index, items) => index === 0 || items[index - 1].max < item.min);
    })).toBe(true);
    await conversationAction(page, 'next-word'); await conversationAction(page, 'next-word');
    voice.text = 'sierra romeo charlie slash capital alpha papa papa dot tango sierra xray';
    await dictate(page); await conversationAction(page, 'spell');
    await expect.poll(async () => (await conversationState(page))?.voiceResult).toBe('src/App.tsx');
    await conversationAction(page, 'replace');
    await conversationAction(page, 'newline');
    voice.text = 'Keep the tests.';
    await dictate(page); await conversationAction(page, 'append');
    const draft = 'Edit src/App.tsx\nKeep the tests.';
    await expect.poll(async () => (await conversationState(page))?.draft).toBe(draft);
    await conversationAction(page, 'done');
    await microphoneReleased(page);
    await showPanel(page, 'conversation');
    await page.screenshot({ path: 'test-results/vr-composer.png' });
    await hideProjection(page);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const sent: Array<{ text: string; sessionId: string; participantId: string; mode: string }> = [];
    await page.route('**/api/agent/message', async (route) => {
      sent.push(route.request().postDataJSON());
      await pending;
      await route.fulfill({ status: 503, json: { error: 'Temporary failure' } });
    });
    await page.evaluate(() => {
      const send = document.querySelector<HTMLButtonElement>('[data-immersive-action="conversation:send"]')!;
      send.click(); send.click();
    });
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ text: draft, sessionId: SESSION, participantId: AGENT });
    await openSession(page, EMPTY);
    release();
    await conversationAction(page, 'compose');
    await expect.poll(async () => (await conversationState(page))?.draft).toBe('');
    await openSession(page, SESSION);
    await conversationAction(page, 'compose');
    await expect.poll(async () => (await conversationState(page))?.draft).toBe(draft);
    expect(sent).toHaveLength(1);
    await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click();
    await released(page);
    await page.reload(); await enter(page); await conversationAction(page, 'compose');
    await expect.poll(async () => (await conversationState(page))?.draft).toBe(draft);
  });

  test('keeps speech during panel movement and shows microphone activity before Stop', async ({ page }) => {
    await setupVoice(page);
    // Chrome's default fake microphone is silent. Feed a known tone through the real capture
    // graph to distinguish measured activity from an animation that runs during silence.
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const gain = context.createGain(); gain.gain.value = 0.1;
        const destination = context.createMediaStreamDestination();
        oscillator.connect(gain).connect(destination); oscillator.start();
        await context.resume();
        const track = destination.stream.getAudioTracks()[0];
        const stop = track.stop.bind(track);
        track.stop = () => { stop(); oscillator.stop(); void context.close(); };
        window.voiceTestTracks.push(track);
        return destination.stream;
      };
    });
    const actions = () => page.evaluate(() => {
      const result: string[] = [];
      window.xrScene?.scene.getObjectByName('Conversation tools')?.traverse((object) => {
        if (object.userData.immersiveAction) result.push(object.userData.immersiveAction);
      });
      return result;
    });
    await expect.poll(actions).toHaveLength(2);
    expect(await actions()).not.toContain('conversation:delete');
    await pointAtAction(page, 'conversation:send');
    await expect.poll(() => page.evaluate(() => window.xrScene?.scene.getObjectByName('Send tooltip')?.visible)).toBe(true);
    await pointAtAction(page, 'conversation:record');
    await expect.poll(() => page.evaluate(() => window.xrScene?.scene.getObjectByName('Dictate tooltip')?.visible)).toBe(true);
    await page.mouse.down(); await page.mouse.up(); await hideProjection(page);
    await expect.poll(async () => (await conversationState(page))?.voiceSeconds).toBeGreaterThan(0);
    await expect.poll(async () => (await conversationState(page))?.voiceLevel).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => window.xrScene?.scene.getObjectByName('Conversation history')?.userData.disabled)).toBe(true);
    await conversationAction(page, 'list');
    await expect.poll(async () => (await conversationState(page))?.voicePhase).toBe('recording');
    await conversationAction(page, 'compose');
    await expect.poll(async () => (await conversationState(page))?.voicePhase).toBe('recording');
    await panelAction(page, 'canvas', 'drag');
    await expect.poll(async () => (await conversationState(page))?.voicePhase).toBe('recording');
    await panelAction(page, 'canvas', 'done');
    await expect.poll(async () => (await conversationState(page))?.voiceSeconds).toBeGreaterThanOrEqual(1);
    await showPanel(page, 'conversation');
    await page.screenshot({ path: 'test-results/vr-recording.png' });
    await hideProjection(page);
    await conversationAction(page, 'stop');
    await expect.poll(async () => (await conversationState(page))?.voiceResult).toBe('Edit badpath');
    await panelAction(page, 'conversation', 'drag');
    await panelAction(page, 'conversation', 'done');
    await panelAction(page, 'conversation', 'resize');
    await panelAction(page, 'conversation', 'large');
    await conversationAction(page, 'compose');
    await expect.poll(async () => (await conversationState(page))?.voiceResult).toBe('Edit badpath');
    await conversationAction(page, 'edit');
    await conversationAction(page, 'append');
    await expect.poll(async () => (await conversationState(page))?.draft).toBe('Edit badpath');
    await conversationAction(page, 'next-word');
    await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
    await conversationAction(page, 'record');
    await expect.poll(async () => (await conversationState(page))?.voiceStatus).toContain('Microphone denied');
    await expect.poll(async () => (await conversationState(page))?.selectedWord).toBe('Edit');
    await expect.poll(() => page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__!.logicalTexturePixels)).toBeLessThanOrEqual(5_592_405);
    await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click();
    await microphoneReleased(page); await released(page);
  });

  test('stops capture on close and exit, ignores late speech, and recovers from failure or denial', async ({ page }) => {
    const voice = await setupVoice(page);
    await dictate(page); await conversationAction(page, 'append');
    voice.fail = true;
    await dictate(page);
    await expect.poll(async () => (await conversationState(page))?.voiceStatus).toContain('Transcription unavailable');
    await expect.poll(async () => (await conversationState(page))?.draft).toBe('Edit badpath');
    await conversationAction(page, 'record');
    await expect.poll(async () => (await conversationState(page))?.voicePhase).toBe('recording');
    await panelAction(page, 'conversation', 'close'); await microphoneReleased(page);
    await panelAction(page, 'conversation', 'open');
    await expect.poll(async () => (await conversationState(page))?.conversationTab).toBe('read');
    await conversationAction(page, 'compose');
    voice.fail = false;
    let release!: () => void;
    voice.pending = new Promise<void>((resolve) => { release = resolve; });
    await conversationAction(page, 'record');
    await expect.poll(async () => (await conversationState(page))?.voicePhase).toBe('recording');
    await page.waitForTimeout(180); await conversationAction(page, 'stop');
    await expect.poll(async () => (await conversationState(page))?.voicePhase).toBe('transcribing');
    await openSession(page, EMPTY); release();
    await conversationAction(page, 'compose');
    await expect.poll(async () => (await conversationState(page))?.draft).toBe('');
    await microphoneReleased(page);
    await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
    await conversationAction(page, 'record');
    await expect.poll(async () => (await conversationState(page))?.voiceStatus).toContain('Microphone denied');
    await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click(); await released(page);
  });

  test('releases late microphone permission and recording on exit or processing failure', async ({ page }) => {
    await setupVoice(page);
    await page.evaluate(() => {
      const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.voiceTestCapture = capture;
      navigator.mediaDevices.getUserMedia = (constraints) => new Promise((resolve, reject) => {
        window.releaseVoicePermission = () => { void capture(constraints).then(resolve, reject); };
      });
    });
    await conversationAction(page, 'record');
    await expect.poll(async () => (await conversationState(page))?.voicePhase).toBe('starting');
    await panelAction(page, 'conversation', 'close');
    await page.evaluate(() => window.releaseVoicePermission?.());
    await expect.poll(() => page.evaluate(() => window.voiceTestTracks.length)).toBe(1);
    await microphoneReleased(page);
    await page.evaluate(() => { navigator.mediaDevices.getUserMedia = window.voiceTestCapture!; });
    await panelAction(page, 'conversation', 'open'); await conversationAction(page, 'compose');
    await conversationAction(page, 'record');
    await expect.poll(async () => (await conversationState(page))?.voicePhase).toBe('recording');
    await page.evaluate(() => window.voiceTestTracks.at(-1)!.dispatchEvent(new Event('ended')));
    await expect.poll(async () => (await conversationState(page))?.voiceStatus).toContain('Microphone disconnected');
    await microphoneReleased(page);
    await conversationAction(page, 'record');
    await expect.poll(async () => (await conversationState(page))?.voicePhase).toBe('recording');
    await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click();
    await microphoneReleased(page); await released(page);
  });

  test('uses shared agent actions, rejects unsupported modes, and bounds tool resources', async ({ page }) => {
    await setupVoice(page);
    await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
    await conversationAction(page, 'agents');
    await expect.poll(() => page.evaluate(() => window.xrScene?.scene.getObjectByName('Agent')?.userData.disabled)).toBe(true);
    await conversationAction(page, 'ask');
    await expect(page.getByRole('radio', { name: 'Ask', exact: true })).toHaveAttribute('aria-checked', 'true');
    const original = await page.evaluate(async (id) => (await (await fetch(`/api/sessions/${id}`)).json()).session as PublicSession, SESSION);
    const updated = structuredClone(original);
    const addedId = '88888888-8888-4888-8888-888888888888';
    let additions = 0; let changes = 0;
    await page.route(`**/api/sessions/${SESSION}/participants`, async (route) => {
      const input = route.request().postDataJSON();
      if (route.request().method() === 'POST') {
        additions++;
        updated.participants.push({ id: addedId, kind: 'agent', displayName: 'Reviewer', provider: input.provider, role: input.role, defaultMode: 'ask' });
      } else { changes++; expect(input.primaryAgentId).toBe(addedId); updated.primaryAgentId = addedId; }
      updated.revision++;
      await route.fulfill({ json: { session: updated } });
    });
    await conversationAction(page, 'add');
    await expect.poll(() => additions).toBe(1);
    await expect(page.getByRole('button', { name: '@Reviewer Reviewer', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await conversationAction(page, 'make-primary'); await expect.poll(() => changes).toBe(1);
    await conversationAction(page, 'previous-agent');
    await expect(page.getByRole('button', { name: '@Claude Coder', exact: true })).toHaveAttribute('aria-pressed', 'true');
    for (let cycle = 0; cycle < 5; cycle++) {
      for (const action of ['read', 'compose', 'agents']) {
        await conversationAction(page, action);
        await expect.poll(() => page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__!.logicalTexturePixels)).toBeLessThanOrEqual(5_592_405);
        await expect.poll(() => page.evaluate((action) => Boolean(window.xrScene?.scene.getObjectByName(action === 'agents' ? 'VR draft and agents' : 'Message input')), action)).toBe(true);
      }
    }
    await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click(); await released(page);
  });

  test('cancels the selected run while a second run remains untouched after focus changes', async ({ page }) => {
    await setupVoice(page);
    await dictate(page); await conversationAction(page, 'append');
    const otherId = '99999999-9999-4999-8999-999999999999';
    const firstRun = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const secondRun = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const snapshot = await page.evaluate(async (id) => (await (await fetch(`/api/sessions/${id}`)).json()).session as PublicSession, SESSION);
    await page.route(`**/api/sessions/${otherId}`, (route) => route.fulfill({ json: { session: { ...snapshot, id: otherId, title: 'Other running session' } } }));
    await page.route('**/api/agent/runs*', (route) => route.fulfill({ json: { active: [
      { runId: firstRun, sessionId: SESSION }, { runId: secondRun, sessionId: otherId },
    ].map((run) => ({ ...run, participantId: AGENT, state: 'running', enqueuedAt: 1, pendingPermissionCount: 0, pendingPermissions: [] })), recent: [] } }));
    let releaseStreams!: () => void;
    const streams = new Promise<void>((resolve) => { releaseStreams = resolve; });
    await page.route('**/api/agent/stream?*', async (route) => {
      await streams;
      await route.fulfill({ contentType: 'application/x-ndjson', body: '' });
    });
    const cancellations: string[] = [];
    let releaseCancel!: () => void;
    const cancellation = new Promise<void>((resolve) => { releaseCancel = resolve; });
    await page.route('**/api/agent/cancel', async (route) => {
      cancellations.push(route.request().postDataJSON().runId);
      await cancellation;
      await route.fulfill({ status: 503, json: { error: 'Cancellation could not be confirmed.' } });
    });
    await page.reload(); await enter(page); await conversationAction(page, 'compose');
    await expect.poll(() => page.evaluate(() => window.xrScene?.scene.getObjectByName('Cancel run')?.userData.disabled)).toBe(false);
    expect(await page.evaluate(() => {
      const scene = window.xrScene!.scene;
      const panel = scene.getObjectByName('Conversation panel')!;
      const cancel = scene.getObjectByName('Cancel run')!;
      const status = scene.getObjectByName('Voice status')!;
      scene.updateMatrixWorld(true);
      return {
        cancel: panel.worldToLocal(cancel.getWorldPosition(window.xrScene!.camera.position.clone())).toArray(),
        status: panel.worldToLocal(status.getWorldPosition(window.xrScene!.camera.position.clone())).toArray(),
      };
    })).toMatchObject({
      cancel: [expect.closeTo(0.48, 5), expect.closeTo(-0.43, 5), expect.any(Number)],
      status: [expect.closeTo(0, 5), expect.closeTo(-0.45, 5), expect.any(Number)],
    });
    await page.evaluate(() => {
      const cancel = document.querySelector<HTMLButtonElement>('[data-immersive-action="conversation:cancel"]')!;
      cancel.click(); cancel.click();
    });
    await expect.poll(() => cancellations).toEqual([firstRun]);
    await openSession(page, EMPTY); await conversationAction(page, 'compose');
    releaseCancel();
    await expect.poll(async () => (await conversationState(page))?.draft).toBe('');
    await expect.poll(() => page.evaluate(() => Boolean(window.xrScene?.scene.getObjectByName('Cancel run')))).toBe(false);
    expect(cancellations).toEqual([firstRun]);
    releaseStreams();
    await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click(); await released(page);
  });
});

const LOCAL = '11111111-1111-4111-8111-111111111111';
const REMOTE = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const REMOTE_PROJECT = '44444444-4444-4444-8444-444444444444';
const SESSION = '55555555-5555-4555-8555-555555555555';
const EMPTY = '66666666-6666-4666-8666-666666666666';
const AGENT = '77777777-7777-4777-8777-777777777777';
const NOW = '2026-09-08T12:00:00.000Z';

declare global {
  interface Window {
    voiceTestTracks: MediaStreamTrack[];
    voiceTestCapture?: MediaDevices['getUserMedia'];
    releaseVoicePermission?: () => void;
    xrScene?: RootState;
    xrStore?: XRStore;
    xrFixture: {
      entries: number; ends: number; destroys: number; listeners: number;
      reject: boolean; pending: boolean; resolve?: () => void; systemEnd?: () => void;
      setVisibility?: (visibility: XRVisibilityState) => void;
      setControllers?: (count: number) => void;
    };
  }
}

async function installAdapter(page: Page, options: { supported?: boolean; failImport?: boolean } = {}) {
  await page.addInitScript(({ supported, failImport }) => {
    const stats = window.xrFixture = { entries: 0, ends: 0, destroys: 0, listeners: 0, reject: false, pending: false } as Window['xrFixture'];
    window.__CODEAI_XR_TEST__ = {
      failXRImport: failImport,
      onStore(store) { window.xrStore = store; },
      onWorkspace(state) { window.xrScene = state; },
      adapter: {
        async isSessionSupported() { return supported !== false; },
        async enterVR() {
          stats.entries++;
          if (stats.reject) throw new DOMException('User denied access', 'NotAllowedError');
          const listeners = { end: new Set<() => void>(), visibilitychange: new Set<() => void>(), inputsourceschange: new Set<() => void>() };
          const session = {
            visibilityState: 'visible' as XRVisibilityState,
            // Native XRInputSourceArray is iterable, not an Array with filter().
            inputSources: new Set<Pick<XRInputSource, 'targetRayMode' | 'hand'>>(),
            async end() { stats.ends++; for (const listener of listeners.end) listener(); },
            addEventListener(type: keyof typeof listeners, listener: () => void) { listeners[type].add(listener); stats.listeners++; },
            removeEventListener(type: keyof typeof listeners, listener: () => void) { if (listeners[type].delete(listener)) stats.listeners--; },
          };
          stats.systemEnd = () => { for (const listener of listeners.end) listener(); };
          stats.setVisibility = (visibility) => {
            session.visibilityState = visibility;
            for (const listener of listeners.visibilitychange) listener();
          };
          stats.setControllers = (count) => {
            session.inputSources = new Set(Array.from({ length: count }, () => ({ targetRayMode: 'tracked-pointer' as const })));
            // Exercise the actual store subscription path that previously ended VR. Native
            // controller rendering stays inactive in this adapter without a reference space.
            window.xrStore?.setState({ inputSourceStates: Array.from({ length: count }, () => ({
              type: 'controller', gamepad: {},
            })) as unknown as ReturnType<XRStore['getState']>['inputSourceStates'] });
            for (const listener of listeners.inputsourceschange) listener();
          };
          if (stats.pending) await new Promise<void>((resolve) => { stats.resolve = resolve; });
          return session;
        },
        destroy() { stats.destroys++; },
      },
    };
  }, options);
}

async function workspaceFixture(page: Page, withRepository = false, historyMessages = 0, extraConversations = 0, multipleRepositories = false) {
  const state = { annotationWrites: 0, diffReads: 0, statusReads: 0, statusCheckoutIds: [] as string[], diffRequests: [] as Array<{ checkoutId: string; path: string }>,
    holdDiff: undefined as Promise<void> | undefined, online: true, failLoad: false, authenticated: true, holdLoad: undefined as Promise<void> | undefined };
  const project = (id: string, name: string): DurableProject => ({ version: 1, revision: 0, id, name, repositories: [], createdAt: NOW, updatedAt: NOW });
  const session = (id: string, projectId: string, title: string): PublicSession => ({
    version: 3, revision: 0, id, projectId, title, repositories: [], createdAt: NOW, updatedAt: NOW,
    participants: [
      { id: `${id}:human`, kind: 'human', displayName: 'You' },
      { id: AGENT, kind: 'agent', displayName: 'Claude', provider: 'claude', role: 'coder', defaultMode: 'plan' },
    ],
    primaryAgentId: AGENT, messages: [], annotations: {}, sketches: [], pinnedDiagramIds: [],
  });
  const local = session(SESSION, PROJECT, 'Canvas session');
  if (withRepository) {
    local.repositories = [{ id: 'binding', hostId: LOCAL, checkoutId: 'checkout', role: 'primary' }];
    if (multipleRepositories) local.repositories.push({ id: 'reference-binding', hostId: LOCAL, checkoutId: 'reference-checkout', role: 'reference' });
    local.messages = [{ id: 'reading-fixture', role: 'assistant', authorId: AGENT, createdAt: NOW, status: 'complete', rawMarkdown: '', blocks: [
      { kind: 'markdown', markdown: 'Reading fixture: keep the conversation, diagram, and repository evidence beside one another. Compare the result, then arrange the panels from your seat.' },
      { kind: 'code', language: 'ts', source: 'function resetWorkspace() {\n  return panels.map(panel => ({ ...panel, open: true }));\n}' },
      { kind: 'diagram', artifact: { id: 'reading-diagram', sessionId: SESSION, messageId: 'reading-fixture', ordinal: 1, source: 'flowchart LR\n A[Conversation] --> B[Canvas] --> C[Evidence]', createdAt: NOW, status: 'ready', derivedFromDiagramIds: [], evidence: [] } },
    ] }];
  }
  local.sketches = [{ id: 'sketch-fixture', ordinal: 1, sessionId: SESSION, createdAt: NOW, viewBox: [0, 0, 1600, 1000] }];
  for (let index = 0; index < historyMessages; index++) local.messages.push(index % 2 === 0
    ? { id: `history-${index}`, role: 'user', authorId: `${SESSION}:human`, addressedParticipantId: AGENT, createdAt: NOW, status: 'sent',
      text: `Message ${index}: can we simplify this?`, diagramAttachments: [] }
    : { id: `history-${index}`, role: 'assistant', authorId: AGENT, createdAt: NOW, status: 'complete',
      rawMarkdown: `Message ${index}: yes, let's keep the conversation easy to follow.`, blocks: [] });
  const remote = session(EMPTY, REMOTE_PROJECT, 'Empty remote session');
  const olderSessions = Array.from({ length: extraConversations }, (_, index) => ({
    ...session(`99999999-9999-4999-8999-${String(index).padStart(12, '0')}`, PROJECT, `Older conversation ${index + 1}`),
    updatedAt: new Date(Date.parse(NOW) - (index + 1) * 3_600_000).toISOString(),
  }));
  if (extraConversations) remote.updatedAt = new Date(Date.parse(NOW) + 3_600_000).toISOString();
  const snapshot = (id: string, name: string, item: PublicSession): ArenaMachineSnapshot => ({
    machine: { id, label: name, kind: id === LOCAL ? 'local' : 'remote', state: id === REMOTE && !state.online ? 'offline' : 'online', lastSeenAt: NOW },
    projects: [project(item.projectId!, id === LOCAL ? 'Local project' : 'Remote project')],
    checkouts: [], recentCheckoutIds: [],
    providers: { claude: { available: true, authenticated: true, supportedModes: ['ask', 'plan'] }, codex: { available: false, authenticated: 'unknown', supportedModes: [] } },
    sessions: [item, ...(id === LOCAL ? [...olderSessions].reverse() : [])].map((record) => ({
      id: record.id, projectId: record.projectId, revision: 0, title: record.title, repositoryCheckoutIds: [], agents: [], updatedAt: record.updatedAt,
    })),
    archivedSessions: [], runs: { active: [], recent: [] },
  });
  await page.route('**/api/auth/status', (route) => route.fulfill({ json: { mode: 'paired', authenticated: state.authenticated, transportSecure: true, hostLabel: 'Home' } }));
  await page.route('**/api/projects', (route) => route.fulfill({ json: { projects: [project(PROJECT, 'Local project')] } }));
  await page.route('**/api/checkouts', (route) => route.fulfill({ json: { hostId: LOCAL, checkouts: withRepository ? [
    { id: 'checkout', name: 'Fixture', relativePath: 'fixture' },
    ...(multipleRepositories ? [{ id: 'reference-checkout', name: 'Reference', relativePath: 'reference' }] : []),
  ] : [], recentCheckoutIds: [] } }));
  await page.route('**/api/arena', (route) => route.fulfill({ json: { machines: [snapshot(LOCAL, 'Home', local), snapshot(REMOTE, 'Laptop', remote)] } }));
  await page.route('**/api/agent/runs*', (route) => route.fulfill({ json: { active: [], recent: [] } }));
  await page.route('**/api/sessions?*', (route) => route.fulfill({ json: { sessions: [local, ...olderSessions] } }));
  for (const item of olderSessions) await page.route(`**/api/sessions/${item.id}`, (route) => route.fulfill({ json: { session: item } }));
  await page.route(`**/api/sessions/${SESSION}/annotations`, (route) => {
    state.annotationWrites++;
    const annotation = route.request().postDataJSON()?.annotation;
    if (annotation?.diagramId) {
      local.annotations[annotation.diagramId] = annotation;
      local.revision++;
    }
    return route.fulfill({ json: { session: local } });
  });
  await page.route(`**/api/sessions/${SESSION}/sketches`, (route) => {
    const sketch = route.request().postDataJSON()?.sketch;
    if (sketch) { local.sketches.push(sketch); local.revision++; }
    return route.fulfill({ status: 201, json: { session: local } });
  });
  await page.route(`**/api/sessions/${SESSION}`, (route) => route.fulfill({ json: { session: local } }));
  await page.route(`**/api/machines/${REMOTE}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/sessions')) {
      await state.holdLoad;
      await route.fulfill(state.failLoad ? { status: 503, json: { error: 'Remote session loading failed' } } : { json: { sessions: [remote] } });
    } else if (path.endsWith(`/sessions/${EMPTY}`)) await route.fulfill({ json: { session: remote } });
    else await route.fulfill({ json: { active: [], recent: [] } });
  });
  await page.route('**/api/repository/status?*', (route) => {
    state.statusReads++;
    const checkoutId = new URL(route.request().url()).searchParams.get('checkoutId') || '';
    state.statusCheckoutIds.push(checkoutId);
    if (checkoutId === 'reference-checkout') return route.fulfill({ json: { tree: { isRepository: true, branch: 'reference', files: [
      { path: 'reference.ts', status: 'untracked', staged: false, unstaged: true },
    ] } } });
    return route.fulfill({ json: { tree: { isRepository: true, files: [
      { path: 'fixture.ts', status: 'modified', staged: true, unstaged: true },
      { path: 'other.ts', status: 'modified', staged: false, unstaged: true },
    ] } } });
  });
  await page.route('**/api/repository/diff?*', async (route) => {
    state.diffReads++;
    await state.holdDiff;
    const url = new URL(route.request().url());
    const path = url.searchParams.get('path') || '';
    state.diffRequests.push({ checkoutId: url.searchParams.get('checkoutId') || '', path });
    return route.fulfill({ json: { diff: { path, staged: '@@ staged @@\n+  first change',
      unstaged: Array.from({ length: 60 }, (_, i) => `+  ${path} line ${i}`).join('\n') } } });
  });
  return Object.assign(state, { local, remote, snapshot });
}

const controls = (page: Page) => page.getByRole('group', { name: 'Immersive workspace controls' });
const openSession = (page: Page, id: string) => controls(page).locator(`[data-immersive-session="${id}"]`).click();
async function enter(page: Page) {
  await page.getByRole('button', { name: 'Enter VR', exact: true }).click();
  await expect(controls(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__?.sessionActive)).toBe(true);
}
async function released(page: Page) {
  await expect.poll(() => page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__?.sessionActive)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__?.liveResources)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.xrFixture.listeners)).toBe(0);
}

for (const location of ['Arena', 'Inbox', 'Flat', 'Spatial', 'Empty'] as const) {
  test(`enters once from ${location} without changing the desktop canvas selection`, async ({ page }) => {
    await installAdapter(page);
    await workspaceFixture(page);
    await page.goto(location === 'Arena' ? '/arena' : location === 'Inbox' ? '/arena/inbox' : '/');
    if (location === 'Spatial') await page.getByRole('button', { name: 'Spatial', exact: true }).click();
    if (location === 'Empty') {
      await page.getByRole('link', { name: 'Arena', exact: true }).click();
      await page.getByRole('button', { name: 'Open Empty remote session', exact: true }).click();
      await expect(page.locator('.empty-canvas')).toBeVisible();
    }
    await expect(page.locator('.app-loading')).toHaveCount(0);
    const before = await page.evaluate(() => localStorage.getItem('code-ai:device:v1:workspace'));
    await enter(page);
    expect(await page.evaluate(() => window.xrFixture.entries)).toBe(1);
    await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click();
    await released(page);
    expect(await page.evaluate(() => window.xrFixture.ends)).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem('code-ai:device:v1:workspace'))).toBe(before);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Enter VR', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => window.xrFixture.entries)).toBe(0);
  });
}

for (const [colorScheme, expected] of [['dark', '1a1a1a'], ['light', 'b0b0b0']] as const) {
  test(`applies the ${colorScheme} environment token to the XR scene`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await installAdapter(page);
    await workspaceFixture(page);
    await page.goto('/');
    await enter(page);
    await expect.poll(() => page.evaluate(() => {
      const background = window.xrScene?.scene.background;
      return background && 'getHexString' in background ? background.getHexString() : undefined;
    })).toBe(expected);
    expect(await page.evaluate(() => {
      const title = window.xrScene!.scene.getObjectByName('Focus Conversation display') as Mesh;
      return (title.material as import('three').MeshBasicMaterial).color.getHexString();
    })).toBe('ffffff');
    await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click();
    await released(page);
  });
}

test('continues into VR and records a diagnostic when immersive fonts fail to load', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document.fonts, 'load', {
      configurable: true,
      value: () => Promise.reject(new Error('Injected font loading failure.')),
    });
  });
  await installAdapter(page);
  await workspaceFixture(page);
  await page.goto('/');
  await enter(page);
  expect(await page.evaluate(() => window.__CODEAI_VR_DIAGNOSTICS__?.().events
    .some((entry) => entry.event === 'font-loading-failed'))).toBe(true);
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click();
  await released(page);
});

test('continues to the VR entry when immersive font loading never settles', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document.fonts, 'load', {
      configurable: true,
      value: () => new Promise(() => undefined),
    });
  });
  await installAdapter(page);
  await workspaceFixture(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Enter VR', exact: true })).toBeEnabled({ timeout: 5_000 });
  expect(await page.evaluate(() => window.__CODEAI_VR_DIAGNOSTICS__?.().events
    .some((entry) => entry.event === 'font-loading-failed'))).toBe(true);
});

test('keeps panel geometry in the thin depth stack and inside rounded panel bounds', async ({ page }) => {
  await installAdapter(page);
  await workspaceFixture(page, true);
  await page.goto('/');
  await enter(page);
  await panelAction(page, 'evidence', 'open');
  await expect.poll(() => livePanelIds(page)).toEqual(['canvas', 'conversation', 'evidence']);
  const violations = await page.evaluate(() => {
    const failures: string[] = [];
    const panels: Array<import('three').Object3D> = [];
    const scene = window.xrScene!.scene;
    scene.updateMatrixWorld(true);
    scene.traverse((object) => { if (object.userData.workspacePanel) panels.push(object); });
    for (const panel of panels) {
      panel.traverse((object) => {
        const mesh = object as Mesh;
        const positions = mesh.geometry?.attributes.position;
        if (!positions) return;
        const tooltip = Boolean(object.userData.immersiveTooltip);
        let ancestor: import('three').Object3D | null = object;
        let controlBar = false;
        while (ancestor && ancestor !== panel) {
          if (ancestor.name.includes('toolbar') || ancestor.name.includes('control bar')) controlBar = true;
          ancestor = ancestor.parent;
        }
        let maxDepth = 0;
        let outside = false;
        for (let index = 0; index < positions.count; index++) {
          const point = panel.worldToLocal(object.localToWorld(window.xrScene!.camera.position.clone().set(
            positions.getX(index), positions.getY(index), positions.getZ(index),
          )));
          maxDepth = Math.max(maxDepth, Math.abs(point.z));
          outside ||= Math.abs(point.x) > 0.7001 || Math.abs(point.y) > 0.9001;
        }
        if (!tooltip && maxDepth > 0.0101) failures.push(`${panel.name}/${object.name}: depth ${maxDepth}`);
        if (!tooltip && !controlBar && !object.name.includes('focus outline') && outside) {
          failures.push(`${panel.name}/${object.name}: outside bounds`);
        }
        const material = mesh.material as import('three').Material | import('three').Material[] | undefined;
        const materials = Array.isArray(material) ? material : material ? [material] : [];
        if (!object.name.endsWith(' surface') && materials.some((entry) => entry.depthWrite)) {
          failures.push(`${panel.name}/${object.name}: writes depth`);
        }
      });
    }
    return failures;
  });
  expect(violations).toEqual([]);
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click();
  await released(page);
});

test('retains one XR store across machine/project navigation, loading races, history, failure and Offline', async ({ page }) => {
  await installAdapter(page);
  const state = await workspaceFixture(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  await page.getByRole('complementary', { name: 'Conversation' }).locator('textarea').fill('Keep this local draft');
  await enter(page);
  let resolveLoad!: () => void;
  state.holdLoad = new Promise<void>((resolve) => { resolveLoad = resolve; });
  await openSession(page, EMPTY);
  await expect(controls(page).getByRole('status')).toHaveText('Loading session…');
  await openSession(page, SESSION);
  resolveLoad();
  state.holdLoad = undefined;
  await expect(controls(page).getByRole('status')).not.toContainText('Loading');
  await expect(controls(page).locator('strong').first()).toHaveText('Canvas session');
  await openSession(page, EMPTY);
  await expect(controls(page).locator('strong').first()).toHaveText('Empty remote session');
  await page.getByRole('link', { name: 'Arena', exact: true }).click();
  await page.getByRole('link', { name: /^Inbox/ }).click();
  await page.goBack();
  await expect(controls(page)).toBeVisible();
  await openSession(page, SESSION);
  state.failLoad = true;
  await openSession(page, EMPTY);
  await expect(controls(page).getByRole('status')).toContainText('Remote session loading failed');
  state.failLoad = false;
  await openSession(page, SESSION);
  state.online = false;
  await expect(controls(page).locator(`[data-immersive-session="${EMPTY}"]`)).toContainText('Offline');
  await openSession(page, EMPTY);
  await expect(controls(page).getByRole('status')).toContainText('Laptop is Offline');
  await expect(controls(page).locator('strong').first()).toHaveText('Canvas session');
  expect(await page.evaluate(() => ({ entries: window.xrFixture.entries, ends: window.xrFixture.ends, destroys: window.xrFixture.destroys })))
    .toEqual({ entries: 1, ends: 0, destroys: 0 });
  await controls(page).getByRole('button', { name: 'Reset view' }).click();
  await controls(page).getByRole('button', { name: 'Exit VR' }).click();
  await released(page);
  await expect(page.getByRole('complementary', { name: 'Conversation' }).locator('textarea')).toHaveValue('Keep this local draft');
});

test('keeps VR and panel state through controller removal, reconnection and visibility interruptions', async ({ page }) => {
  await installAdapter(page);
  await workspaceFixture(page);
  await page.goto('/');
  await enter(page);
  await controls(page).locator('[data-immersive-action="panel:evidence:close"]').click();
  const layout = await page.evaluate(() => localStorage.getItem('code-ai:device:v1:immersive-layout'));
  for (const count of [2, 1, 0, 1, 2]) {
    await page.evaluate((count) => window.xrFixture.setControllers?.(count), count);
    await expect(controls(page)).toBeVisible();
    expect(await page.evaluate(() => window.xrFixture.ends)).toBe(0);
  }
  for (const visibility of ['visible-blurred', 'hidden', 'visible'] as const) {
    await page.evaluate((visibility) => window.xrFixture.setVisibility?.(visibility), visibility);
    await expect(controls(page)).toBeVisible();
    expect(await page.evaluate(() => window.xrFixture.ends)).toBe(0);
  }
  expect(await page.evaluate(() => localStorage.getItem('code-ai:device:v1:immersive-layout'))).toBe(layout);
  expect(await page.evaluate(() => window.xrFixture.entries)).toBe(1);
  const events = await page.evaluate(() => window.__CODEAI_VR_DIAGNOSTICS__!().events);
  expect(events.filter((event) => event.event === 'controllers-changed').map((event) => event.controllers)).toEqual([2, 1, 0, 1, 2]);
  expect(events.filter((event) => event.event === 'visibility-changed').map((event) => event.visibility)).toEqual(['visible-blurred', 'hidden', 'visible']);
  // Content actions remain usable after input/visibility resume.
  await controls(page).locator('[data-immersive-action="panel:evidence:open"]').click();
  await expect(controls(page).locator('[data-immersive-panel="evidence"]')).toHaveAttribute('data-open', 'true');
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click();
  await released(page);
  expect(await page.evaluate(() => window.__CODEAI_VR_DIAGNOSTICS__!().events.slice(-2).map((event) => event.event)))
    .toEqual(['exit-requested', 'session-ended']);
});

test('samples diagnostics and removes the timer and error listeners after session end', async ({ page }) => {
  await page.clock.install();
  await installAdapter(page);
  await workspaceFixture(page);
  await page.goto('/');
  await enter(page);
  await expect.poll(() => page.evaluate(() => window.__CODEAI_VR_DIAGNOSTICS__!().events.filter((event) => event.event === 'sample').length), { timeout: 15_000 }).toBeGreaterThan(0);
  const sample = await page.evaluate(() => window.__CODEAI_VR_DIAGNOSTICS__!().events.find((event) => event.event === 'sample'));
  expect(sample).toMatchObject({ sessionActive: true, visibility: 'visible', controllers: 0 });
  expect(sample!.frames).toBeGreaterThan(0);
  expect(sample!.textures).toBeGreaterThan(0);
  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'Do not persist arbitrary error content' }));
    window.dispatchEvent(new Event('unhandledrejection'));
  });
  expect(await page.evaluate(() => window.__CODEAI_VR_DIAGNOSTICS__!().events.slice(-2).map((event) => event.event)))
    .toEqual(['window-error', 'unhandled-rejection']);
  await page.evaluate(() => window.xrFixture.systemEnd?.());
  await released(page);
  await expect(page.locator('.immersive-entry [role="alert"]')).toContainText('headset or browser ended VR');
  const previous = await page.evaluate(() => window.__CODEAI_VR_DIAGNOSTICS__!().events);
  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent('error'));
    window.dispatchEvent(new Event('unhandledrejection'));
  });
  await page.clock.fastForward(20_000);
  expect(await page.evaluate(() => window.__CODEAI_VR_DIAGNOSTICS__!().events)).toEqual(previous);
});

test('retains VR exit diagnostics across reload with a new document identity', async ({ page }) => {
  await installAdapter(page);
  await workspaceFixture(page);
  await page.goto('/');
  await enter(page);
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click();
  await released(page);
  const previous = await page.evaluate(() => window.__CODEAI_VR_DIAGNOSTICS__!().events);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Enter VR', exact: true })).toBeEnabled();
  const reloaded = await page.evaluate(() => window.__CODEAI_VR_DIAGNOSTICS__!().events);
  expect(reloaded.slice(0, previous.length)).toEqual(previous);
  expect(reloaded.at(-1)?.event).toBe('page-ready');
  expect(reloaded.at(-1)?.pageStartedAt).not.toBe(previous.at(-1)?.pageStartedAt);
  expect(await page.evaluate(() => window.xrFixture.entries)).toBe(0);
});

test('contains broken canvas/transcript surfaces and cleans up rejection, system end, context loss and revocation', async ({ page }) => {
  await installAdapter(page);
  const state = await workspaceFixture(page);
  await page.goto('/');
  await page.evaluate(() => {
    window.xrFixture.reject = true;
    window.__CODEAI_SPATIAL_TEST__ = { failTextureId: 'sketch-fixture' };
    window.__CODEAI_XR_TEST__!.failTranscript = true;
  });
  await page.getByRole('button', { name: 'Enter VR', exact: true }).click();
  await expect(page.locator('.immersive-entry [role="alert"]')).toContainText('Immersive entry was denied');
  await page.evaluate(() => { window.xrFixture.reject = false; });
  await enter(page);
  await expect.poll(() => page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__?.logicalTexturePixels || 0)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__!.logicalTexturePixels)).toBeLessThanOrEqual(5_592_405);
  await controls(page).getByRole('button', { name: 'Reset view' }).click();
  await openSession(page, EMPTY);
  await expect(controls(page).locator('strong').first()).toHaveText('Empty remote session');
  await page.evaluate(() => window.xrFixture.systemEnd?.());
  await released(page);
  expect(await page.evaluate(() => window.xrFixture.ends)).toBe(0);
  await enter(page);
  await page.locator('.immersive-viewport canvas').dispatchEvent('webglcontextlost');
  await expect(page.locator('.immersive-entry [role="alert"]')).toContainText('WebGL context was lost');
  await released(page);
  expect(await page.evaluate(() => window.__CODEAI_VR_DIAGNOSTICS__!().events.slice(-2).map((event) => event.event)))
    .toEqual(['webgl-context-lost', 'session-ended']);
  expect(await page.evaluate(() => window.xrFixture.ends)).toBe(1);
  await enter(page);
  state.authenticated = false;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('heading', { name: 'Pair this device' })).toBeVisible();
  await released(page);
  await expect.poll(() => page.evaluate(() => window.xrFixture.destroys)).toBe(1);
  expect(await page.evaluate(() => window.xrFixture.ends)).toBe(2);
});

test('ends a pending entry once when access is revoked and when the document leaves', async ({ page }) => {
  await installAdapter(page);
  const state = await workspaceFixture(page);
  await page.goto('/');
  await page.evaluate(() => { window.xrFixture.pending = true; });
  await page.getByRole('button', { name: 'Enter VR', exact: true }).click();
  state.authenticated = false;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('heading', { name: 'Pair this device' })).toBeVisible();
  await page.evaluate(() => window.xrFixture.resolve?.());
  await expect.poll(() => page.evaluate(() => window.xrFixture.ends)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.xrFixture.destroys)).toBe(1);
  await released(page);
  state.authenticated = true;
  await page.reload();
  await page.evaluate(() => { window.xrFixture.pending = true; });
  await page.getByRole('button', { name: 'Enter VR', exact: true }).click();
  await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pagehide')); window.xrFixture.resolve?.(); });
  await expect.poll(() => page.evaluate(() => window.xrFixture.ends)).toBe(1);
  await released(page);
});

for (const failImport of [false, true]) {
  test(`keeps ordinary desktop use lazy and usable with ${failImport ? 'a failed XR import' : 'unsupported XR'}`, async ({ page }) => {
    await installAdapter(page, { supported: failImport, failImport });
    await workspaceFixture(page);
    await page.goto('/');
    if (failImport) await expect(page.locator('.immersive-entry [role="alert"]')).toContainText('The immersive renderer could not load');
    else await expect(page.getByText('VR unavailable', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__CODEAI_XR_BUNDLE_EVALUATIONS__)).toBeUndefined();
    expect(await page.evaluate(() => window.__CODEAI_SPATIAL_INSTRUMENTATION__)).toBeUndefined();
    await expect(page.getByRole('button', { name: 'Flat', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Spatial', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Spatial canvas projection' })).toBeVisible();
  });
}

const panel = (page: Page, id: string) => controls(page).locator(`[data-immersive-panel="${id}"]`);
const panelAction = (page: Page, id: string, command: string) => controls(page).locator(`[data-immersive-action="panel:${id}:${command}"]`).click();
const storedLayout = (page: Page) => page.evaluate(() => localStorage.getItem('code-ai:device:v1:immersive-layout'));
const livePanelIds = (page: Page) => page.evaluate(() => {
  const ids: string[] = [];
  window.xrScene?.scene.traverse((object) => { if (object.userData.workspacePanel) ids.push(object.userData.workspacePanel); });
  return ids.sort();
});

async function pointAtAction(page: Page, action: string, point?: number[]) {
  await expect.poll(() => page.evaluate(({ action, point }) => {
    let target: Mesh | undefined;
    let localPosition: number[] = point || [0.01, 0.005, 0];
    window.xrScene?.scene.traverse((object) => {
      if (object.userData.immersiveAction === action || (action === 'message-input' && object.userData.immersiveMessageInput)
        || (action.startsWith('session:') && object.userData.immersiveSession?.sessionId === action.slice(8))) target = object as Mesh;
    });
    const list = window.xrScene?.scene.getObjectByName('Conversation list scroll') as Mesh | undefined;
    if (list && (action.startsWith('session:') || action === 'load-more-sessions')) {
      const model = list.userData.immersiveConversationList;
      const position = action === 'load-more-sessions' ? model.loadMorePosition
        : model.rows.find((row: { choice: { sessionId: string } }) => row.choice.sessionId === action.slice(8))?.position;
      if (position) { target = list; localPosition = position; }
    }
    if (!target || !window.xrScene) return false;
    const { camera, scene } = window.xrScene;
    scene.updateMatrixWorld(true);
    // Aim inside a triangle: the exact center lies on the quad's shared edge and can
    // miss both triangles through floating-point rounding at some camera angles.
    camera.lookAt(target.localToWorld(camera.position.clone().set(localPosition[0], localPosition[1], localPosition[2])));
    camera.updateMatrixWorld(true);
    return true;
  }, { action, point })).toBe(true);
  await page.locator('.immersive-viewport').evaluate((element: HTMLElement) => {
    element.style.opacity = '1'; element.style.zIndex = '200'; element.style.pointerEvents = 'auto';
    element.querySelector('canvas')!.style.pointerEvents = 'auto';
  });
  const box = (await page.locator('.immersive-viewport canvas').boundingBox())!;
  // Camera rotation alone does not emit a desktop pointer event. Move off the last
  // screen coordinate before pointing at the new target to refresh the hover ray.
  await page.mouse.move(box.x + box.width / 2 + 2, box.y + box.height / 2 + 2);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

async function pointAtCanvasUv(page: Page, u: number, v: number) {
  await expect.poll(() => page.evaluate(({ u, v }) => {
    const target = window.xrScene?.scene.getObjectByName('Active canvas') as Mesh | undefined;
    if (!target || !window.xrScene) return false;
    const { camera, scene } = window.xrScene;
    const size = (target.geometry as import('three').PlaneGeometry).parameters;
    scene.updateMatrixWorld(true);
    const point = camera.position.clone().set((u - 0.5) * size.width, (v - 0.5) * size.height, 0);
    camera.lookAt(target.localToWorld(point));
    camera.updateMatrixWorld(true);
    return true;
  }, { u, v })).toBe(true);
  await page.locator('.immersive-viewport').evaluate((element: HTMLElement) => {
    element.style.opacity = '1'; element.style.zIndex = '200'; element.style.pointerEvents = 'auto';
    element.querySelector('canvas')!.style.pointerEvents = 'auto';
  });
  const box = (await page.locator('.immersive-viewport canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 + 2, box.y + box.height / 2 + 2);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}
async function showPanel(page: Page, id: string) {
  await pointAtAction(page, `panel:${id}:focus`);
  await page.evaluate((id) => {
    const { scene, camera } = window.xrScene!;
    const object = scene.getObjectByName(`${id[0].toUpperCase()}${id.slice(1)} panel`)!;
    camera.lookAt(object.getWorldPosition(camera.position.clone()));
    camera.updateMatrixWorld(true);
  }, id);
}
async function hideProjection(page: Page) {
  await page.locator('.immersive-viewport').evaluate((element: HTMLElement) => {
    element.style.opacity = '0'; element.style.zIndex = ''; element.style.pointerEvents = 'none';
    element.querySelector('canvas')!.style.pointerEvents = 'none';
  });
}

async function moveHeldPanel(page: Page) {
  // Translating the ray origin exercises the same push/pull math as a tracked controller.
  await page.evaluate(() => {
    const { camera } = window.xrScene!;
    const direction = camera.getWorldDirection(camera.position.clone());
    direction.y = 0;
    camera.position.addScaledVector(direction.normalize(), -0.2);
    camera.position.x += 0.03; camera.position.y += 0.12;
    camera.updateMatrixWorld(true);
  });
  const box = (await page.locator('.immersive-viewport canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 + 6, box.y + box.height / 2, { steps: 3 });
}

test('identifies the conversation, scrolls a continuous thread, and returns from its list', async ({ page }) => {
  await installAdapter(page);
  await workspaceFixture(page, false, 24);
  await page.goto('/'); await enter(page);
  const history = () => page.evaluate(() => window.xrScene?.scene.getObjectByName('VR chat messages')?.userData.immersiveHistory);
  const heading = () => page.evaluate(() => window.xrScene?.scene.getObjectByName('Conversation panel')?.userData);
  await expect.poll(() => livePanelIds(page)).toEqual(['canvas', 'conversation']);
  await expect.poll(heading).toMatchObject({ heading: 'Canvas session', detail: 'Local project · Home · Online' });
  await expect.poll(async () => (await history())?.atBottom).toBe(true);
  expect(await page.evaluate(() => Boolean(window.xrScene?.scene.getObjectByName('Latest')))).toBe(false);
  expect((await history()).visibleMessageIds.length).toBeGreaterThan(1);
  const bottom = (await history()).offset;
  const texture = await page.evaluate(() => ((window.xrScene!.scene.getObjectByName('VR chat messages') as Mesh).material as import('three').MeshBasicMaterial).map!.uuid);
  await showPanel(page, 'conversation');
  const box = (await page.locator('.immersive-viewport canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -180);
  await expect.poll(async () => (await history())?.offset).toBeLessThan(bottom);
  await expect.poll(() => page.evaluate(() => window.xrScene?.scene.getObjectByName('Latest')?.parent?.parent?.position.toArray())).toEqual([0.55, -0.32, 0]);
  const afterWheel = (await history()).offset;
  expect(bottom - afterWheel).toBeLessThan(400);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 32, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await history())?.offset).toBeLessThan(afterWheel);
  const readingOffset = (await history()).offset;
  expect(await page.evaluate(() => ((window.xrScene!.scene.getObjectByName('VR chat messages') as Mesh).material as import('three').MeshBasicMaterial).map!.uuid)).toBe(texture);
  await page.screenshot({ path: 'test-results/vr-conversation-scroll.png' });
  await hideProjection(page);
  await conversationAction(page, 'list');
  await expect.poll(heading).toMatchObject({ heading: 'Conversations' });
  await expect.poll(() => page.evaluate(() => Boolean(window.xrScene?.scene.getObjectByName('Conversation list')))).toBe(true);
  await conversationAction(page, 'back');
  await expect.poll(async () => (await history())?.offset).toBe(readingOffset);
  await expect.poll(heading).toMatchObject({ heading: 'Canvas session' });
  await conversationAction(page, 'latest');
  await expect.poll(async () => (await history())?.atBottom).toBe(true);
  await expect.poll(() => page.evaluate(() => Boolean(window.xrScene?.scene.getObjectByName('Latest')))).toBe(false);
  await conversationAction(page, 'list');
  await showPanel(page, 'conversation');
  await page.screenshot({ path: 'test-results/vr-conversation-list.png' });
  await pointAtAction(page, `session:${EMPTY}`);
  await expect.poll(() => page.evaluate(() => window.xrScene?.scene.getObjectByName('Conversation list scroll')
    ?.userData.immersiveConversationList.hoveredSessionId)).toBe(EMPTY);
  await page.mouse.down(); await page.mouse.up(); await hideProjection(page);
  await expect.poll(heading).toMatchObject({ heading: 'Empty remote session' });
  expect(await page.evaluate(() => window.xrFixture.entries)).toBe(1);
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click(); await released(page);
});

test('sorts conversation activity, scrolls without selecting, and loads older conversations at the end', async ({ page }) => {
  await installAdapter(page); await workspaceFixture(page, false, 0, 25);
  await page.clock.setFixedTime(new Date(Date.parse(NOW) + 2 * 3_600_000));
  await page.goto('/'); await enter(page); await conversationAction(page, 'list');
  const listState = () => page.evaluate(() => window.xrScene?.scene.getObjectByName('Conversation list scroll')?.userData.immersiveConversationList);
  await expect.poll(async () => (await listState())?.loadedCount).toBe(20);
  expect((await listState()).visibleSessionIds.slice(0, 3)).toEqual([EMPTY, SESSION, '99999999-9999-4999-8999-000000000000']);
  expect((await listState()).rows[0].timeLabel).toBe('Updated 1h ago');
  expect(await page.evaluate(() => window.xrScene?.scene.getObjectByName('Back to conversation')?.parent?.parent?.position.toArray())).toEqual([-0.56, 0.81, 0]);
  const texture = await page.evaluate(() => ((window.xrScene!.scene.getObjectByName('Conversation list scroll') as Mesh).material as import('three').MeshBasicMaterial).map!.uuid);
  await showPanel(page, 'conversation');
  await page.screenshot({ path: 'test-results/vr-conversation-list-times.png' });
  await pointAtAction(page, `session:${SESSION}`);
  const box = (await page.locator('.immersive-viewport canvas').boundingBox())!;
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 45, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await listState())?.offset).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.xrScene?.scene.getObjectByName('Conversation panel')?.userData.heading)).toBe('Conversations');
  await page.mouse.wheel(0, 100_000);
  await expect.poll(async () => (await listState())?.loadMorePosition).toBeTruthy();
  const before = (await listState()).offset;
  await pointAtAction(page, 'load-more-sessions');
  await page.mouse.down(); await page.mouse.up();
  await expect.poll(async () => (await listState())?.loadedCount).toBe(27);
  expect((await listState()).offset).toBe(before);
  expect((await listState()).hasMore).toBe(false);
  await page.mouse.wheel(0, 100_000);
  const oldest = '99999999-9999-4999-8999-000000000024';
  await expect.poll(async () => (await listState())?.visibleSessionIds).toContain(oldest);
  expect(await page.evaluate(() => ((window.xrScene!.scene.getObjectByName('Conversation list scroll') as Mesh).material as import('three').MeshBasicMaterial).map!.uuid)).toBe(texture);
  await pointAtAction(page, `session:${oldest}`);
  await page.mouse.down(); await page.mouse.up(); await hideProjection(page);
  await expect.poll(() => page.evaluate(() => window.xrScene?.scene.getObjectByName('Conversation panel')?.userData.heading)).toBe('Older conversation 25');
  await conversationAction(page, 'list');
  await pointAtAction(page, 'conversation:back');
  await page.mouse.down(); await page.mouse.up(); await hideProjection(page);
  await expect.poll(() => page.evaluate(() => window.xrScene?.scene.getObjectByName('Conversation panel')?.userData.heading)).toBe('Older conversation 25');
  expect(await page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__!.logicalTexturePixels)).toBeLessThanOrEqual(5_592_405);
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click(); await released(page);
});

test('delays tooltip appearance, fades it, and cancels a brief hover', async ({ page }) => {
  await installAdapter(page); await workspaceFixture(page);
  await page.goto('/'); await enter(page);
  const opacity = () => page.evaluate(() => window.xrScene?.scene.getObjectByName('Conversation history tooltip')?.userData.tooltipOpacity || 0);
  await pointAtAction(page, 'conversation:list');
  await page.waitForTimeout(100);
  expect(await opacity()).toBe(0);
  await pointAtAction(page, 'panel:conversation:focus');
  await page.waitForTimeout(500);
  expect(await opacity()).toBe(0);
  expect(await page.evaluate(() => Boolean(window.xrScene?.scene.getObjectByName('Focus Conversation tooltip')))).toBe(false);
  await pointAtAction(page, 'panel:conversation:toggle');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => Boolean(window.xrScene?.scene.getObjectByName('Hide Conversation tooltip')))).toBe(false);
  await pointAtAction(page, 'conversation:list');
  await expect.poll(opacity).toBe(1);
  expect(await page.evaluate(() => {
    const scene = window.xrScene!.scene;
    const panel = scene.getObjectByName('Conversation panel')!;
    const tooltip = scene.getObjectByName('Conversation history tooltip')!;
    scene.updateMatrixWorld(true);
    return panel.worldToLocal(tooltip.getWorldPosition(window.xrScene!.camera.position.clone())).z;
  })).toBeCloseTo(0.01, 4);
  expect(await page.evaluate(() => {
    const tooltip = window.xrScene!.scene.getObjectByName('Conversation history tooltip') as Mesh;
    const material = tooltip.material as import('three').MeshBasicMaterial;
    return { depthTest: material.depthTest, depthWrite: material.depthWrite, renderOrder: tooltip.renderOrder };
  })).toEqual({ depthTest: false, depthWrite: false, renderOrder: 1000 });
  await pointAtAction(page, 'panel:conversation:focus');
  await expect.poll(opacity).toBe(0);
  await hideProjection(page);
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click(); await released(page);
});

test('arranges every panel, isolates content actions, recovers tools and restores device layouts', async ({ page }) => {
  await installAdapter(page);
  const fixture = await workspaceFixture(page);
  await page.goto('/');
  await expect(page.locator('.app-loading')).toHaveCount(0);
  await expect.poll(() => fixture.annotationWrites).toBe(1);
  const desktop = await page.evaluate(() => localStorage.getItem('code-ai:device:v1:workspace'));
  const record = await page.evaluate(async (id) => (await fetch(`/api/sessions/${id}`)).text(), SESSION);
  let writes = 0;
  page.on('request', (request) => { if (request.method() !== 'GET' && request.url().includes('/api/')) writes++; });
  await enter(page);
  await expect.poll(() => livePanelIds(page)).toEqual(['canvas', 'conversation']);
  await panelAction(page, 'evidence', 'open');
  for (const id of ['canvas', 'conversation', 'evidence']) {
    await panelAction(page, id, 'focus');
    await expect(panel(page, id)).toHaveAttribute('data-focused', 'true');
    const before = JSON.parse((await panel(page, id).getAttribute('data-layout'))!);
    const savedBeforeDrag = await storedLayout(page);
    await expect.poll(() => page.evaluate((id) => {
      const { scene, camera } = window.xrScene!;
      const title = id[0].toUpperCase() + id.slice(1);
      const panel = scene.getObjectByName(`${title} panel`)!;
      const toolbar = scene.getObjectByName(`${title} toolbar`);
      if (!toolbar) return false;
      scene.updateMatrixWorld(true);
      const icons: Mesh[] = [];
      toolbar.traverse((object) => { if (object.userData.immersiveAction) icons.push(object as Mesh); });
      return icons.length === 3 && icons.every((icon) => {
        const position = panel.worldToLocal(icon.getWorldPosition(camera.position.clone()));
        const size = (icon.geometry as import('three').PlaneGeometry).parameters;
        return position.y + size.height / 2 < -0.92 && size.width === size.height
          && Math.abs(position.x) + size.width / 2 <= 0.4701;
      });
    }, id)).toBe(true);
    for (const [command, label] of [['resize', 'Size'], ['close', 'Close'], ['drag', 'Drag']]) {
      await pointAtAction(page, `panel:${id}:${command}`);
      await expect.poll(() => page.evaluate(({ id, label }) =>
        window.xrScene?.scene.getObjectByName(`${label} ${id[0].toUpperCase()}${id.slice(1)} tooltip`)?.visible,
      { id, label }), `show ${label} tooltip for ${id}`).toBe(true);
      expect(await storedLayout(page)).toBe(savedBeforeDrag);
    }
    await pointAtAction(page, `panel:${id}:focus`);
    await expect.poll(() => page.evaluate((id) =>
      Boolean(window.xrScene?.scene.getObjectByName(`Drag ${id[0].toUpperCase()}${id.slice(1)} tooltip`)?.visible), id)).toBe(false);
    await pointAtAction(page, `panel:${id}:drag`);
    await page.mouse.down();
    await moveHeldPanel(page);
    await expect.poll(() => page.evaluate((id) => window.xrScene?.scene.getObjectByName(`${id[0].toUpperCase()}${id.slice(1)} content`)?.pointerEvents, id)).toBe('none');
    expect(await storedLayout(page)).toBe(savedBeforeDrag);
    await page.mouse.up();
    await pointAtAction(page, `panel:${id}:resize`);
    await page.mouse.down(); await page.mouse.up();
    await pointAtAction(page, `panel:${id}:extra-large`);
    await page.mouse.down(); await page.mouse.up();
    await hideProjection(page);
    const moved = JSON.parse((await panel(page, id).getAttribute('data-layout'))!);
    expect(moved.height).toBeGreaterThan(before.height);
    expect(moved.distance).toBeLessThan(before.distance);
    expect(moved.angle).not.toBe(before.angle);
    expect(moved.size).toBe('extra-large');
    await pointAtAction(page, `panel:${id}:close`);
    await page.mouse.down(); await page.mouse.up();
    await hideProjection(page);
    await expect.poll(() => livePanelIds(page)).not.toContain(id);
    await panelAction(page, id, 'open');
    await expect(panel(page, id)).toHaveAttribute('data-layout', JSON.stringify(moved));
  }
  const saved = await storedLayout(page);
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click();
  await released(page);
  expect(await page.evaluate(() => localStorage.getItem('code-ai:device:v1:workspace'))).toBe(desktop);
  expect(writes).toBe(0);
  expect(await page.evaluate(async (id) => (await fetch(`/api/sessions/${id}`)).text(), SESSION)).toBe(record);
  await page.reload();
  await enter(page);
  expect(await storedLayout(page)).toBe(saved);
  await openSession(page, EMPTY);
  await expect(panel(page, 'canvas')).toHaveAttribute('data-layout', JSON.stringify({ angle: 0, height: 0, distance: 2.6, size: 'medium', open: true }));
  await openSession(page, SESSION);
  await expect(panel(page, 'canvas')).not.toHaveAttribute('data-layout', JSON.stringify({ angle: 0, height: 0, distance: 2.6, size: 'medium', open: true }));
  await controls(page).getByRole('button', { name: 'Reset workspace', exact: true }).click();
  await expect(panel(page, 'canvas')).toHaveAttribute('data-layout', JSON.stringify({ angle: 0, height: 0, distance: 2.6, size: 'medium', open: true }));
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click();
  await released(page);
});

test('selects real world controls by ray, ignores hover and recenters restored panels on re-entry', async ({ page }) => {
  await installAdapter(page);
  await page.addInitScript(() => localStorage.setItem('code-ai:device:v1:immersive-layout', '{corrupt'));
  await workspaceFixture(page);
  await page.goto('/');
  await enter(page);
  await pointAtAction(page, 'panel:conversation:focus');
  await expect(panel(page, 'canvas')).toHaveAttribute('data-focused', 'true');
  await page.mouse.down(); await page.mouse.up();
  await expect(panel(page, 'conversation')).toHaveAttribute('data-focused', 'true');
  await pointAtAction(page, 'panel:conversation:drag');
  await page.mouse.down();
  await moveHeldPanel(page);
  await page.mouse.up();
  expect(JSON.parse((await panel(page, 'conversation').getAttribute('data-layout'))!).angle).not.toBe(36);
  await hideProjection(page);
  await page.evaluate(() => { window.xrScene!.camera.position.set(1, 1.6, 2); window.xrScene!.camera.rotation.set(0, Math.PI / 2, 0); });
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click();
  await released(page);
  const saved = await storedLayout(page);
  await enter(page);
  await expect.poll(() => page.evaluate(() => {
    const origin = window.xrScene?.scene.getObjectByName('Workspace origin');
    return origin ? { position: origin.position.toArray(), yaw: Math.round(origin.rotation.y * 1e8) / 1e8 } : undefined;
  })).toEqual({ position: [1, 1.6, 2], yaw: Math.round(Math.PI / 2 * 1e8) / 1e8 });
  expect(await storedLayout(page)).toBe(saved);
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click();
  await released(page);
});

test('cancels captured drags safely and chooses every size preset through the world menu', async ({ page }) => {
  test.setTimeout(90_000);
  await installAdapter(page);
  const fixture = await workspaceFixture(page, true);
  await page.goto('/');
  await enter(page);
  await panelAction(page, 'canvas', 'focus');
  const saved = await storedLayout(page);
  await pointAtAction(page, 'panel:canvas:drag');
  await page.mouse.down();
  await moveHeldPanel(page);
  // Leave the panel completely: capture must keep the preview moving without a content click.
  await page.mouse.move(1, 1);
  expect(await storedLayout(page)).toBe(saved);
  await page.locator('.immersive-viewport canvas').dispatchEvent('pointercancel', { pointerId: 1, button: 0 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.xrScene?.scene.getObjectByName('Canvas panel')?.userData.editing)).toBeUndefined();
  expect(await storedLayout(page)).toBe(saved);
  await expect.poll(() => page.evaluate(() => window.xrScene?.internal.capturedMap.size)).toBe(0);

  await hideProjection(page);
  await panelAction(page, 'evidence', 'open');
  await pointAtAction(page, 'panel:evidence:drag');
  await page.mouse.down();
  await moveHeldPanel(page);
  await hideProjection(page);
  const reads = fixture.diffReads;
  // Programmatic click represents another controller trying a content action during the drag.
  await controls(page).locator('[data-immersive-action="next-file"]').evaluate((button: HTMLButtonElement) => button.click());
  expect(fixture.diffReads).toBe(reads);
  await controls(page).locator('[data-immersive-action="reset-workspace"]').evaluate((button: HTMLButtonElement) => button.click());
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.xrScene?.internal.capturedMap.size)).toBe(0);

  for (const [size, scale] of [['small', 0.85], ['medium', 1], ['large', 1.15], ['extra-large', 1.3]] as const) {
    await pointAtAction(page, 'panel:canvas:resize');
    await page.mouse.down(); await page.mouse.up();
    await pointAtAction(page, `panel:canvas:${size}`);
    await page.mouse.down(); await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.xrScene?.scene.getObjectByName('Canvas panel')?.scale.x)).toBe(scale);
  }
  await pointAtAction(page, 'panel:canvas:resize');
  await page.screenshot({ path: 'test-results/vr-panel-toolbar.png' });
  await page.mouse.down(); await page.mouse.up();
  await showPanel(page, 'canvas');
  await page.screenshot({ path: 'test-results/vr-panel-size-menu.png' });
  await pointAtAction(page, 'panel:canvas:drag');
  await page.mouse.down();
  await moveHeldPanel(page);
  const beforeExit = await storedLayout(page);
  await page.evaluate(() => window.xrFixture.systemEnd?.());
  await page.mouse.up();
  await released(page);
  await hideProjection(page);
  await enter(page);
  expect(await storedLayout(page)).toBe(beforeExit);
  await expect.poll(() => page.evaluate(() => window.xrScene?.scene.getObjectByName('Canvas panel')?.userData.editing)).toBeUndefined();
  await pointAtAction(page, 'panel:canvas:drag');
  await page.mouse.down();
  await moveHeldPanel(page);
  await hideProjection(page);
  await controls(page).locator(`[data-immersive-session="${EMPTY}"]`).evaluate((button: HTMLButtonElement) => button.click());
  await expect(controls(page).locator('strong').first()).toHaveText('Empty remote session');
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.xrScene?.internal.capturedMap.size)).toBe(0);
  expect(await storedLayout(page)).toBe(beforeExit);
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click();
  await released(page);
});

test('shares a paged diff with desktop and bounds resources across twenty open/close/reset cycles', async ({ page }) => {
  test.setTimeout(120_000);
  await installAdapter(page);
  const state = await workspaceFixture(page, true);
  await page.goto('/');
  await enter(page);
  await panelAction(page, 'evidence', 'open');
  await controls(page).getByRole('button', { name: 'Next file', exact: true }).click();
  await expect.poll(() => state.diffReads).toBe(1);
  await expect(page.getByRole('region', { name: 'Changes in fixture.ts' })).toBeAttached();
  await expect.poll(() => page.evaluate(() => {
    let ready = false;
    window.xrScene?.scene.getObjectByName('Evidence content')?.traverse((object) => {
      const mesh = object as Mesh;
      const material = mesh.material as { map?: { image?: HTMLCanvasElement } } | undefined;
      if (material?.map?.image?.width === 1024 && material.map.image.height === 768) ready = true;
    });
    return ready;
  })).toBe(true);
  await controls(page).getByRole('button', { name: 'Next page', exact: true }).click();
  expect(state.diffReads).toBe(1);
  await panelAction(page, 'evidence', 'resize');
  await controls(page).getByRole('button', { name: 'Next file', exact: true }).click();
  expect(state.diffReads).toBe(1);
  await panelAction(page, 'evidence', 'done');
  await controls(page).getByRole('button', { name: 'Next canvas', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.xrScene?.scene.getObjectByName('Active canvas')?.userData)).toMatchObject({ canvasTarget: 'reading-diagram', canvasStatus: 'ready' });
  const aspect = await page.evaluate(() => {
    const { scene, camera } = window.xrScene!;
    scene.updateMatrixWorld(true);
    const mesh = scene.getObjectByName('Active canvas') as Mesh;
    const scale = mesh.getWorldScale(camera.position.clone());
    const size = (mesh.geometry as import('three').PlaneGeometry).parameters;
    const image = (mesh.material as import('three').MeshBasicMaterial).map!.image as HTMLCanvasElement;
    return { world: size.width * scale.x / (size.height * scale.y), raster: image.width / image.height };
  });
  expect(aspect.world).toBeCloseTo(aspect.raster, 1);
  await showPanel(page, 'conversation');
  await page.screenshot({ path: 'test-results/vr-conversation-panel.png' });
  await showPanel(page, 'evidence');
  await page.screenshot({ path: 'test-results/vr-evidence-panel.png' });
  await showPanel(page, 'canvas');
  await page.screenshot({ path: 'test-results/vr-canvas-panel.png' });
  await hideProjection(page);
  const baseline = await page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__!.liveResources);
  for (let cycle = 0; cycle < 20; cycle++) {
    for (const id of ['canvas', 'conversation', 'evidence']) await panelAction(page, id, 'close');
    await expect.poll(() => livePanelIds(page)).toEqual([]);
    await expect.poll(() => page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__!.logicalTexturePixels)).toBeLessThan(800_000);
    await controls(page).getByRole('button', { name: 'Reset workspace', exact: true }).click();
    await expect.poll(() => livePanelIds(page)).toHaveLength(2);
    expect(await page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__!.logicalTexturePixels)).toBeLessThanOrEqual(5_592_405);
  }
  await expect.poll(() => page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__!.liveResources)).toBeLessThanOrEqual(baseline + 12);
  expect(state.diffReads).toBe(1);
  await test.info().attach('vr-resource-budget', { body: JSON.stringify(await page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__), null, 2), contentType: 'application/json' });
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click();
  await released(page);
});

test('routes immersive repository review through the selected session checkout', async ({ page }) => {
  await installAdapter(page);
  const fixture = await workspaceFixture(page, true, 0, 0, true);
  await page.goto('/'); await enter(page); await panelAction(page, 'evidence', 'open');
  const evidenceState = () => page.evaluate(() => window.xrScene?.scene.getObjectByName('Repository evidence')?.userData);
  await expect.poll(async () => (await evidenceState())?.checkoutId).toBe('checkout');
  await expect.poll(async () => (await evidenceState())?.checkouts).toEqual([
    { id: 'checkout', name: 'Fixture' }, { id: 'reference-checkout', name: 'Reference' },
  ]);
  await pointAtAction(page, 'next-checkout'); await page.mouse.down(); await page.mouse.up(); await hideProjection(page);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('code-ai:device:v1:active-checkout'))).toBe('reference-checkout');
  await expect.poll(() => page.evaluate((sessionId) => {
    const stored = JSON.parse(localStorage.getItem('code-ai:device:v1:workspace') || '{}');
    const match = Object.values(stored.scopes || {}).flatMap((scope: any) => Object.entries(scope.views || {}))
      .find(([id]) => id === sessionId);
    return (match?.[1] as { selectedCheckoutId?: string } | undefined)?.selectedCheckoutId;
  }, SESSION)).toBe('reference-checkout');
  await expect.poll(async () => (await evidenceState())?.checkoutId).toBe('reference-checkout');
  await expect.poll(() => fixture.statusCheckoutIds).toContain('reference-checkout');
  await expect.poll(async () => (await evidenceState())?.checkoutName).toBe('Reference');
  expect(await evidenceState()).toMatchObject({ machineLabel: 'Home', branch: 'reference' });
  await controls(page).locator('[data-immersive-action="next-file"]').click();
  await expect.poll(() => fixture.diffRequests.at(-1)).toEqual({ checkoutId: 'reference-checkout', path: 'reference.ts' });
  await expect.poll(async () => (await evidenceState())?.path).toBe('reference.ts');
  await pointAtAction(page, 'previous-checkout'); await page.mouse.down(); await page.mouse.up(); await hideProjection(page);
  await expect.poll(async () => (await evidenceState())?.checkoutId).toBe('checkout');
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click(); await released(page);
});

test('compares canvases, writes canonical controller marks, and sends the marked attachment', async ({ page }) => {
  await installAdapter(page);
  const fixture = await workspaceFixture(page, true);
  await page.route('**/api/health', (route) => route.fulfill({ json: {
    ok: true, hostLabel: 'Home', repositoriesRootReady: true, dataDirectoryReady: true,
    providers: { claude: { available: true, authenticated: true, supportedModes: ['ask', 'plan'] },
      codex: { available: false, authenticated: 'unknown', supportedModes: [] } },
  } }));
  await page.goto('/'); await enter(page);
  const canvasAction = (action: string) => controls(page).locator(`[data-immersive-action="canvas:${action}"]`).click();
  const reviewState = () => page.evaluate(() => window.xrScene?.scene.getObjectByName('Canvas review tools')?.userData);
  await expect.poll(async () => (await reviewState())?.activeId).toBe('sketch-fixture');

  // Move the panel before drawing: the canonical coordinates must still come from texture UVs.
  await pointAtAction(page, 'panel:canvas:drag'); await page.mouse.down(); await moveHeldPanel(page); await page.mouse.up();
  await hideProjection(page);
  await canvasAction('rectangle');
  const drawingPixels = await page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__!.logicalTexturePixels);
  expect(await page.evaluate(() => {
    const scene = window.xrScene!.scene;
    const panel = scene.getObjectByName('Canvas panel')!;
    const surface = scene.getObjectByName('Canvas surface') as Mesh;
    const canvas = scene.getObjectByName('Active canvas') as Mesh;
    scene.updateMatrixWorld(true);
    return {
      depth: panel.worldToLocal(canvas.getWorldPosition(window.xrScene!.camera.position.clone())).z,
      canvasOrder: canvas.renderOrder,
      surfaceOrder: surface.renderOrder,
      depthWrite: (canvas.material as import('three').Material).depthWrite,
    };
  })).toMatchObject({ depth: expect.closeTo(0.004, 5), canvasOrder: 10, surfaceOrder: 1, depthWrite: false });
  await page.evaluate(() => {
    Object.defineProperty(CanvasRenderingContext2D.prototype, 'getImageData', {
      configurable: true,
      value: () => { throw new Error('Injected Quest canvas readback failure.'); },
    });
  });
  await pointAtCanvasUv(page, 0.25, 0.75); await page.mouse.down();
  await pointAtCanvasUv(page, 0.75, 0.25);
  await expect.poll(async () => (await reviewState())?.drawing).toBe(true);
  expect((await reviewState())!.marks).toHaveLength(0);
  expect((await reviewState())!.previewVersion).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__!.logicalTexturePixels)).toBe(drawingPixels);
  const drawingPointerId = (await reviewState())!.drawingPointerId;
  await page.locator('.immersive-viewport canvas').dispatchEvent('lostpointercapture', { pointerId: drawingPointerId });
  await expect.poll(async () => (await reviewState())?.drawing).toBe(true);
  await page.mouse.up(); await hideProjection(page);
  await expect.poll(async () => (await reviewState())?.drawing).toBe(false);
  await expect.poll(async () => (await reviewState())?.marks?.length).toBe(1);
  await expect.poll(() => page.evaluate(() => window.xrScene?.scene.getObjectByName('Active canvas')?.userData.status)).toBe('ready');
  expect(await page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__!.logicalTexturePixels)).toBeLessThanOrEqual(5_592_405);
  const rectangle = (await reviewState())!.marks[0];
  expect(rectangle).toMatchObject({ kind: 'rectangle', x: expect.closeTo(400, 0), y: expect.closeTo(250, 0) });
  expect(rectangle.width).toBeGreaterThan(300); expect(rectangle.width).toBeLessThan(900);
  expect(rectangle.height).toBeGreaterThan(150); expect(rectangle.height).toBeLessThan(600);
  await canvasAction('undo'); await expect.poll(async () => (await reviewState())?.marks?.length).toBe(0);
  await canvasAction('redo'); await expect.poll(async () => (await reviewState())?.marks?.length).toBe(1);

  await canvasAction('text');
  await expect.poll(async () => (await reviewState())?.tool).toBe('text');
  await pointAtCanvasUv(page, 0.5, 0.5); await page.mouse.down(); await page.mouse.up(); await hideProjection(page);
  await expect.poll(async () => Boolean((await reviewState())?.labelPoint)).toBe(true);
  const label = page.locator('[data-immersive-canvas-label]');
  await expect(label).toHaveCount(1); await label.fill('Check this route');
  await canvasAction('commit-label');
  await expect.poll(async () => (await reviewState())?.marks?.length).toBe(2);
  await expect(page.locator('.ink-layer [data-mark-id]')).toHaveCount(2);
  const flatRectangle = page.locator('.ink-layer rect[data-mark-id]');
  await expect(flatRectangle).toHaveAttribute('x', String(rectangle.x));
  await expect(flatRectangle).toHaveAttribute('y', String(rectangle.y));
  await expect(flatRectangle).toHaveAttribute('width', String(rectangle.width));
  await expect(flatRectangle).toHaveAttribute('height', String(rectangle.height));
  await canvasAction('clear');
  expect((await reviewState())!.marks).toHaveLength(2);
  expect((await reviewState())!.clearPending).toBe(true);
  await canvasAction('clear'); await expect.poll(async () => (await reviewState())?.marks?.length).toBe(0);
  await canvasAction('undo'); await expect.poll(async () => (await reviewState())?.marks?.length).toBe(2);
  await expect.poll(() => fixture.annotationWrites).toBeGreaterThan(1);

  await page.evaluate(() => { window.__CODEAI_SPATIAL_TEST__ = { failTextureId: 'reading-diagram' }; });
  await canvasAction('compare');
  await expect.poll(async () => (await reviewState())?.comparisonId).toBe('reading-diagram');
  await expect.poll(() => page.evaluate(() => window.xrScene?.scene.getObjectByName('Comparison canvas')?.userData.status)).toBe('error');
  await expect.poll(() => page.evaluate(() => window.xrScene?.scene.getObjectByName('Active canvas')?.userData.status)).toBe('ready');
  expect(await page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__!.logicalTexturePixels)).toBeLessThanOrEqual(5_592_405);

  expect((await reviewState())!.attached).toBe(true);
  await canvasAction('attach'); await expect.poll(async () => (await reviewState())?.attached).toBe(false);
  await canvasAction('attach'); await expect.poll(async () => (await reviewState())?.attached).toBe(true);
  await conversationAction(page, 'compose');
  const input = page.locator('[data-immersive-message-input]');
  await input.fill('Review the marked route.');
  let messageRequests = 0;
  let sent: { text: string; diagramAttachments: Array<{ diagramId: string; kind?: string; marks: unknown[]; viewport: { viewBox: number[] }; compositePngDataUrl?: string }> } | undefined;
  await page.route('**/api/agent/message', (route) => {
    messageRequests += 1;
    sent = route.request().postDataJSON();
    return route.fulfill({ status: 503, json: { error: 'Injected send failure after capture.' } });
  });
  await conversationAction(page, 'send');
  await expect.poll(() => sent?.diagramAttachments.length).toBe(1);
  expect(sent).toMatchObject({ text: 'Review the marked route.', diagramAttachments: [{
    diagramId: 'sketch-fixture', kind: 'sketch', marks: expect.arrayContaining([
      expect.objectContaining({ kind: 'rectangle' }), expect.objectContaining({ kind: 'text', text: 'Check this route' }),
    ]), viewport: { viewBox: [0, 0, 1_600, 1_000] },
  }] });
  expect(sent!.diagramAttachments[0].compositePngDataUrl).toMatch(/^data:image\/png/);
  await expect(input).toHaveValue('Review the marked route.');
  expect(messageRequests).toBe(1);

  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toDataURL = () => { throw new Error('Injected export failure.'); };
  });
  await input.fill('Retry the marked route.');
  await conversationAction(page, 'send');
  await expect(controls(page).getByRole('status')).toContainText('marked canvas could not be exported');
  await expect(input).toHaveValue('Retry the marked route.');
  expect(messageRequests).toBe(1);

  await canvasAction('sketch');
  await expect.poll(() => fixture.local.sketches.length).toBe(2);
  await expect.poll(async () => (await reviewState())?.activeId).not.toBe('sketch-fixture');
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click(); await released(page);
});

test('ignores a delayed diff after navigating to another machine and keeps recovery controls available', async ({ page }) => {
  await installAdapter(page);
  const state = await workspaceFixture(page, true);
  await page.goto('/');
  await enter(page);
  await expect.poll(() => state.statusReads).toBeGreaterThan(0);
  let resolveDiff!: () => void;
  state.holdDiff = new Promise<void>((resolve) => { resolveDiff = resolve; });
  await panelAction(page, 'evidence', 'open');
  await controls(page).getByRole('button', { name: 'Next file', exact: true }).click();
  await expect.poll(() => state.diffReads).toBe(1);
  await openSession(page, EMPTY);
  await expect(controls(page).locator('strong').first()).toHaveText('Empty remote session');
  resolveDiff();
  state.holdDiff = undefined;
  await expect(page.getByRole('region', { name: 'Changes in fixture.ts' })).toHaveCount(0);
  await controls(page).getByRole('button', { name: 'Next file', exact: true }).click();
  expect(state.diffReads).toBe(1);
  await pointAtAction(page, 'exit');
  await page.mouse.down(); await page.mouse.up();
  await released(page);
});


const sessionAction = (page: Page, action: string) => controls(page).locator(`[data-immersive-action="session:${action}"]`).click();
const sessionToolsState = (page: Page) => page.evaluate(() => window.xrScene?.scene.getObjectByName('VR session tools')?.userData);

test('VR session tools create a repository-free session, attach a checkout, and complete real allow and deny turns', async ({ page, request }) => {
  await installAdapter(page);
  await page.goto('/'); await enter(page);
  await sessionAction(page, 'tools'); await sessionAction(page, 'launcher');
  await expect.poll(async () => (await sessionToolsState(page))?.tab).toBe('launcher');
  const created = page.waitForResponse((response) => response.url().endsWith('/api/sessions') && response.request().method() === 'POST');
  await page.evaluate(() => {
    const create = document.querySelector<HTMLButtonElement>('[data-immersive-action="session:create"]')!;
    create.click(); create.click();
  });
  const response = await created;
  expect(response.status()).toBe(201);
  const { session } = await response.json() as { session: PublicSession };
  expect(session.repositories).toEqual([]);
  await expect(controls(page).locator('strong').first()).toHaveText(session.title);
  await expect.poll(() => page.evaluate(() => Boolean(window.xrScene?.scene.getObjectByName('Message input')))).toBe(true);
  await sessionAction(page, 'tools');
  await expect.poll(async () => (await sessionToolsState(page))?.text).toContain('Primary repository required');
  const attached = page.waitForResponse((res) => res.url().endsWith(`/sessions/${session.id}/repositories`) && res.request().method() === 'PUT');
  await sessionAction(page, 'attach'); expect((await attached).ok()).toBe(true);
  for (const decision of ['allow', 'deny'] as const) {
    await sessionAction(page, 'tools');
    await conversationAction(page, 'agents'); await conversationAction(page, 'agent'); await conversationAction(page, 'agents');
    const input = page.locator('[data-immersive-message-input]');
    await input.fill(`VR real ${decision} turn`);
    await conversationAction(page, 'send');
    await expect.poll(() => page.locator('.permission-card').count()).toBe(1);
    await sessionAction(page, 'tools'); await sessionAction(page, 'permissions');
    await expect.poll(async () => (await sessionToolsState(page))?.text).toContain('README.md');
    await showPanel(page, 'conversation'); await page.screenshot({ path: `test-results/vr-permission-${decision}.png` }); await hideProjection(page);
    const decisionResponse = page.waitForResponse((res) => res.url().endsWith('/api/agent/permission') && res.request().method() === 'POST');
    await pointAtAction(page, `session:${decision}`); await page.mouse.down(); await page.mouse.up(); await hideProjection(page);
    expect((await decisionResponse).ok()).toBe(true);
    await expect.poll(async () => (await sessionToolsState(page))?.permissionStatus).toBe(decision === 'allow' ? 'Allowed.' : 'Denied.');
    await expect.poll(async () => {
      const data = await (await request.get(`/api/sessions/${session.id}`)).json() as { session: PublicSession };
      return data.session.messages.filter((message) => message.role === 'assistant').length;
    }).toBe(decision === 'allow' ? 1 : 2);
    await sessionAction(page, 'tools');
    await input.fill(`Preserve draft after ${decision}`);
    await sessionAction(page, 'tools');
    await sessionAction(page, 'tools');
    await expect(input).toHaveValue(`Preserve draft after ${decision}`);
    await sessionAction(page, 'tools');
  }
  expect(await page.evaluate(() => window.xrFixture.entries)).toBe(1);
  expect(await page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__!.logicalTexturePixels)).toBeLessThanOrEqual(5_592_405);
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click(); await released(page);
});

test('VR permission cards page complete details, retain outcomes, retry explicitly, and capture remote identity across navigation', async ({ page }) => {
  await installAdapter(page);
  const fixture = await workspaceFixture(page, true);
  const pending = [{ requestId: 'request-one', participantId: AGENT, tool: 'Edit', detail: 'START ' + 'long sanitized detail '.repeat(180) + ' END' },
    { requestId: 'request-two', participantId: AGENT, tool: 'Bash', detail: 'Second request' }];
  let online = true;
  await page.route('**/api/arena', (route) => {
    const remote = fixture.snapshot(REMOTE, 'Laptop', fixture.remote);
    remote.machine.state = online ? 'online' : 'offline';
    remote.runs.active = [{ runId: 'remote-run', sessionId: EMPTY, participantId: AGENT, state: 'needs-you',
      enqueuedAt: 1, pendingPermissionCount: pending.length, pendingPermissions: [...pending] }];
    return route.fulfill({ json: { machines: [fixture.snapshot(LOCAL, 'Home', fixture.local), remote] } });
  });
  await page.route(`**/api/machines/${REMOTE}/agent/runs?*`, (route) => route.fulfill({ json: { active: [{
    runId: 'remote-run', sessionId: EMPTY, pendingPermissions: [...pending],
  }], recent: [] } }));
  let responseStatus = 503;
  let hold: Promise<void> | undefined;
  const decisions: Array<{ url: string; runId: string; requestId: string; decision: string }> = [];
  await page.route(`**/api/machines/${REMOTE}/agent/permission`, async (route) => {
    decisions.push({ url: route.request().url(), ...route.request().postDataJSON() });
    await hold;
    await route.fulfill({ status: responseStatus, json: responseStatus === 200 ? { ok: true } : { error: 'Executor disconnected. Refresh and retry.' } });
  });
  await page.goto('/'); await enter(page); await openSession(page, EMPTY);
  await sessionAction(page, 'tools'); await sessionAction(page, 'permissions');
  await expect.poll(async () => (await sessionToolsState(page))?.text).toContain('START');
  const pages = (await sessionToolsState(page))!.pageCount;
  expect(pages).toBeGreaterThan(5);
  for (let i = 1; i < pages; i++) await sessionAction(page, 'newer');
  await expect.poll(async () => (await sessionToolsState(page))?.page).toBe(pages - 1);
  await sessionAction(page, 'allow');
  await expect.poll(async () => (await sessionToolsState(page))?.permissionStatus).toContain('Executor disconnected');
  await sessionAction(page, 'allow'); expect(decisions).toHaveLength(1);
  await sessionAction(page, 'refresh');
  await expect.poll(async () => (await sessionToolsState(page))?.permissionStatus).toContain('Review the details');
  responseStatus = 200;
  let release!: () => void;
  hold = new Promise<void>((resolve) => { release = resolve; });
  await page.evaluate(() => {
    const allow = document.querySelector<HTMLButtonElement>('[data-immersive-action="session:allow"]')!;
    allow.click(); allow.click();
  });
  await expect.poll(() => decisions.length).toBe(2);
  await openSession(page, SESSION); release();
  expect(decisions[1]).toMatchObject({ runId: 'remote-run', requestId: 'request-one', decision: 'allow' });
  expect(decisions[1].url).toContain(`/api/machines/${REMOTE}/agent/permission`);
  await openSession(page, EMPTY); await sessionAction(page, 'tools'); await sessionAction(page, 'permissions');
  await expect.poll(async () => (await sessionToolsState(page))?.permissionStatus).toBe('Allowed.');
  await sessionAction(page, 'allow'); expect(decisions).toHaveLength(2);
  await sessionAction(page, 'next');
  await expect.poll(async () => (await sessionToolsState(page))?.text).toContain('Second request');
  pending.splice(1, 1); // another device answers before selection
  await sessionAction(page, 'refresh');
  await expect.poll(async () => (await sessionToolsState(page))?.permissionStatus).toContain('no longer pending');
  await sessionAction(page, 'deny'); expect(decisions).toHaveLength(2);
  online = false; await sessionAction(page, 'refresh');
  await expect.poll(async () => (await sessionToolsState(page))?.permissionStatus).toContain('offline');
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click(); await released(page);
});

for (const status of [404, 409, 401]) {
  test(`VR permissions report ${status} without retargeting and revoke private content on authorization loss`, async ({ page }) => {
    await installAdapter(page);
    const fixture = await workspaceFixture(page, true);
    const pending = [{ requestId: 'stale-request', participantId: AGENT, tool: 'Edit', detail: 'Original action' }];
    await page.route('**/api/arena', (route) => {
      const home = fixture.snapshot(LOCAL, 'Home', fixture.local);
      home.runs.active = [{ runId: 'stale-run', sessionId: SESSION, participantId: AGENT, state: 'needs-you',
        enqueuedAt: 1, pendingPermissionCount: pending.length, pendingPermissions: [...pending] }];
      return route.fulfill({ json: { machines: [home] } });
    });
    const message = status === 404 ? 'That agent run is no longer active.' : status === 409 ? 'That approval was already resolved.' : 'Pair this device again.';
    let posts = 0;
    await page.route('**/api/agent/permission', (route) => {
      posts++;
      expect(route.request().postDataJSON()).toEqual({ runId: 'stale-run', requestId: 'stale-request', decision: 'deny' });
      if (status === 401) fixture.authenticated = false;
      pending.splice(0, 1, { requestId: 'replacement-request', participantId: AGENT, tool: 'Bash', detail: 'Must not be answered' });
      return route.fulfill({ status, json: { error: message } });
    });
    await page.goto('/'); await enter(page);
    await page.locator('[data-immersive-message-input]').fill('Draft remains separate from approvals.');
    await sessionAction(page, 'tools'); await sessionAction(page, 'permissions');
    await expect.poll(async () => (await sessionToolsState(page))?.text).toContain('Original action');
    await sessionAction(page, 'deny');
    if (status === 401) {
      await expect(page.getByRole('heading', { name: 'Pair this device' })).toBeVisible();
      await released(page);
      expect(await page.evaluate(() => window.xrScene)).toBeUndefined();
    } else {
      await expect.poll(async () => (await sessionToolsState(page))?.permissionStatus).toBe(message);
      await sessionAction(page, 'refresh'); await sessionAction(page, 'allow');
      expect(posts).toBe(1);
      await sessionAction(page, 'tools');
      await expect(page.locator('[data-immersive-message-input]')).toHaveValue('Draft remains separate from approvals.');
      await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click(); await released(page);
    }
    expect(posts).toBe(1);
  });
}

test('VR launcher captures the selected remote project and mode and preserves choices after creation fails', async ({ page }) => {
  await installAdapter(page); const fixture = await workspaceFixture(page, true);
  const requests: unknown[] = [];
  await page.route(`**/api/machines/${REMOTE}/sessions`, (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    requests.push(route.request().postDataJSON());
    return route.fulfill({ status: 503, json: { error: 'Selected executor disconnected.' } });
  });
  await page.goto('/'); await enter(page);
  await sessionAction(page, 'tools'); await sessionAction(page, 'launcher');
  await sessionAction(page, 'machine'); await sessionAction(page, 'project'); await sessionAction(page, 'mode');
  await expect.poll(async () => (await sessionToolsState(page))?.text).toContain('Remote project');
  await sessionAction(page, 'create');
  await expect.poll(async () => (await sessionToolsState(page))?.text).toContain('Selected executor disconnected');
  expect(requests).toEqual([{ provider: 'claude', projectId: REMOTE_PROJECT }]);
  expect((await sessionToolsState(page))?.text).toContain('Mode: plan');
  await showPanel(page, 'conversation'); await page.screenshot({ path: 'test-results/vr-session-launcher.png' }); await hideProjection(page);
  fixture.online = false;
  await sessionAction(page, 'refresh');
  await expect.poll(async () => (await sessionToolsState(page))?.text).toContain('offline');
  await sessionAction(page, 'create'); expect(requests).toHaveLength(1);
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click(); await released(page);
});


test('VR session tools forget the paired device only after an explicit second selection', async ({ page }) => {
  await installAdapter(page); const fixture = await workspaceFixture(page, true);
  await page.route('**/api/auth/status', (route) => route.fulfill({ json: {
    mode: 'paired', authenticated: fixture.authenticated, transportSecure: true, hostLabel: 'Home',
    device: { id: 'paired-headset', label: 'Quest' },
  } }));
  let revoked = 0;
  await page.route('**/api/auth/devices', (route) => {
    expect(route.request().method()).toBe('DELETE');
    expect(route.request().postDataJSON()).toEqual({ deviceId: 'paired-headset' });
    revoked++; fixture.authenticated = false;
    return route.fulfill({ json: { signedOut: true } });
  });
  await page.goto('/'); await enter(page);
  await panelAction(page, 'evidence', 'open');
  await sessionAction(page, 'tools');
  await expect.poll(async () => (await sessionToolsState(page))?.tab).toBe('home');
  expect(await page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__!.logicalTexturePixels)).toBeLessThanOrEqual(5_592_405);
  await sessionAction(page, 'confirm-revoke'); expect(revoked).toBe(0);
  await sessionAction(page, 'revoke'); expect(revoked).toBe(0);
  await expect.poll(async () => (await sessionToolsState(page))?.text).toContain('A new pairing code');
  await sessionAction(page, 'confirm-revoke');
  await expect(page.getByRole('heading', { name: 'Pair this device' })).toBeVisible();
  await released(page); expect(revoked).toBe(1);
});
