import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { CheckoutsResponse, DurableProject, PublicSession } from '../src/shared/types';

async function projectWith(request: APIRequestContext, name: string, relativePath: string) {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const checkout = checkouts.find((item) => item.relativePath === relativePath)!;
  const project = (await (await request.post('/api/projects', { data: { name, checkoutIds: [checkout.id] } })).json()).project as DurableProject;
  const session = (await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json()).session as PublicSession;
  return { project, session };
}

async function selectProject(page: Page, name: string) {
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await expect(page.locator('.project-search-trigger')).toContainText(name);
}

async function chooseMode(page: Page, name: 'Ask' | 'Plan' | 'Agent') {
  await page.getByLabel(/^Mode: /).click();
  await page.getByRole('radiogroup', { name: 'Agent mode' }).getByRole('radio', { name, exact: true }).click();
  await expect(page.getByLabel(/^Mode: /)).toHaveText(name);
}

/**
 * A real PNG, drawn by the browser, handed to the composer the way a paste or a drop hands it over,
 * `count` times at once. A noisy one holds a square of random pixels, which no PNG of that size fits
 * the message bound; a transparent one has nothing behind that square. Answers whether the page
 * cancelled the browser's own handling of every event.
 */
async function deliverImage(page: Page, how: 'paste' | 'drop', width: number, height: number,
  { noise = false, transparent = false, count = 1, besideText = false } = {}): Promise<boolean> {
  return page.evaluate(async (input) => {
    const canvas = document.createElement('canvas');
    canvas.width = input.width; canvas.height = input.height;
    const context = canvas.getContext('2d')!;
    if (!input.transparent) { context.fillStyle = '#3366cc'; context.fillRect(0, 0, input.width, input.height); }
    if (input.noise) {
      const pixels = context.createImageData(700, 700);
      for (let index = 0; index < pixels.data.length; index += 1) pixels.data[index] = index % 4 === 3 ? 255 : Math.floor(Math.random() * 256);
      context.putImageData(pixels, 0, 0);
    }
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
    let cancelled = true;
    for (let index = 0; index < input.count; index += 1) {
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'screenshot.png', { type: 'image/png' }));
      if (input.besideText) transfer.items.add(new File(['notes'], 'notes.txt', { type: 'text/plain' }));
      const event = input.how === 'paste'
        ? new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
        : new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true });
      document.querySelector(input.how === 'paste' ? '.instruction-composer textarea' : '.instruction-composer')!.dispatchEvent(event);
      cancelled &&= event.defaultPrevented;
    }
    return cancelled;
  }, { how, width, height, noise, transparent, count, besideText });
}

/** Drops a file that only claims to be what its type says, of `size` bytes. */
async function dropFile(page: Page, name: string, type: string, size?: number) {
  await page.evaluate((input) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([input.size ? new Uint8Array(input.size) : 'not what it says'], input.name, { type: input.type }));
    document.querySelector('.instruction-composer')!
      .dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, { name, type, size });
}

/**
 * Drags a file over, off, or onto the element `selector` names. Answers whether the page cancelled
 * the browser's own handling, which for a drop would open the file in place of CodeAI. (Chrome
 * ignores a drop effect set on a DataTransfer that no real drag made, so that cannot be read here.)
 */
async function dragFile(page: Page, selector: string, type: 'dragover' | 'dragleave' | 'drop', towards?: string) {
  return page.evaluate((input) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['not what it says'], 'screenshot.png', { type: 'image/png' }));
    const relatedTarget = input.towards ? document.querySelector(input.towards) : null;
    const event = new DragEvent(input.type, { dataTransfer: transfer, bubbles: true, cancelable: true, relatedTarget });
    document.querySelector(input.selector)!.dispatchEvent(event);
    return event.defaultPrevented;
  }, { selector, type, towards });
}

/** The colours of a chip thumbnail's pixels, as red, green, blue, and alpha; -1 is the last row or column. */
async function chipPixels(chip: Locator, points: Array<[number, number]>) {
  return chip.locator('img').evaluate(async (img: HTMLImageElement, at) => {
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(img, 0, 0);
    return at.map(([x, y]) => Array.from(context.getImageData(x < 0 ? img.naturalWidth + x : x, y < 0 ? img.naturalHeight + y : y, 1, 1).data));
  }, points);
}

/** Replaces the browser's encoder until `restoreEncoder`; `rule` is the replacement's source. */
async function replaceEncoder(page: Page, rule: 'oversized' | 'ladder') {
  await page.evaluate((which) => {
    const original = HTMLCanvasElement.prototype.toDataURL;
    const oversized = (type?: string) => `data:${type};base64,${'A'.repeat(1_100_000)}`;
    Object.assign(window, { restoreEncoder: () => { HTMLCanvasElement.prototype.toDataURL = original; } });
    HTMLCanvasElement.prototype.toDataURL = which === 'oversized' ? oversized : function ladder(this: HTMLCanvasElement, type?: string, quality?: number) {
      // At full size this browser cannot encode JPEG, and answers with a PNG as browsers may.
      if (type === 'image/jpeg' && this.width === 2048) return original.call(this, 'image/png');
      // Below it, only the last JPEG quality fits.
      return type === 'image/jpeg' && quality === 0.75 ? original.call(this, type, quality) : oversized(type);
    };
  }, rule);
}

async function restoreEncoder(page: Page) {
  await page.evaluate(() => (window as unknown as { restoreEncoder(): void }).restoreEncoder());
}

/** Writes a plain PNG drawn by the browser to `file`, for a real drag to carry. */
async function pngFile(page: Page, file: string, width: number, height: number) {
  const encoded = await page.evaluate((size) => {
    const canvas = document.createElement('canvas');
    canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#cc6633'; context.fillRect(0, 0, size.width, size.height);
    return canvas.toDataURL('image/png').split(',')[1];
  }, { width, height });
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(encoded, 'base64'));
  return file;
}

/**
 * Drags `file` onto the middle of `target` and drops it there, through Chrome's own drag pipeline.
 * Unlike a constructed event, it honours the drop effect each handler offers: a drop where `none`
 * was offered never fires. (Headless Chrome does not open an unhandled file, so a drop the page
 * failed to refuse shows only as an uncancelled `dragover`.)
 */
async function realDrag(page: Page, target: Locator, file: string) {
  const box = (await target.boundingBox())!;
  const point = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  const cdp = await page.context().newCDPSession(page);
  // Copy, link, and move, as a file manager offers them.
  const data = { items: [], files: [file], dragOperationsMask: 19 };
  for (const type of ['dragEnter', 'dragOver', 'dragOver', 'drop'] as const) {
    await cdp.send('Input.dispatchDragEvent', { type, ...point, data });
  }
  await cdp.detach();
}

/** Records, after the page's own handlers, each `dragover` and `drop`: cancelled or not, and the effect offered. */
async function watchDrags(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = [];
    Object.assign(window, { seenDrags: seen });
    window.addEventListener('dragover', (event) => {
      seen.push(`dragover ${event.defaultPrevented ? 'cancelled' : 'open'} ${event.dataTransfer?.dropEffect}`);
    });
    window.addEventListener('drop', (event) => seen.push(`drop ${event.defaultPrevented ? 'cancelled' : 'open'}`));
  });
}

/** The distinct drag records since the last call. */
async function takeDrags(page: Page) {
  return [...new Set(await page.evaluate(() => (window as unknown as { seenDrags: string[] }).seenDrags.splice(0)))];
}

test.afterEach(async ({ request }) => {
  const active = ((await (await request.get('/api/agent/runs')).json()) as { active?: Array<{ runId: string }> }).active || [];
  await Promise.all(active.map((run) => request.post('/api/agent/cancel', { data: { runId: run.runId } })));
});

test('pastes and drops images into the composer as chips and sends them with the message', async ({ page, request }) => {
  const { project, session } = await projectWith(request, `Images ${Date.now()}`, 'alpha');
  await page.goto('/');
  await selectProject(page, project.name);
  const composer = page.locator('.instruction-composer textarea');
  const chips = page.locator('.attachment-chip.image');
  const send = page.getByRole('button', { name: 'Send', exact: true });
  const notices = page.getByRole('region', { name: 'Notifications' }).locator('.toast');

  // A pasted image becomes a chip with its thumbnail, and nothing is put into the text.
  await composer.fill('Draft kept');
  await deliverImage(page, 'paste', 320, 200);
  await expect(chips).toHaveCount(1);
  await expect(chips.first()).toContainText('Image 1 · PNG · 320×200');
  await expect(composer).toHaveValue('Draft kept');
  await expect(chips.first().locator('img')).toHaveJSProperty('complete', true);
  expect(await chips.first().locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(320);

  // A file dragged over the composer is taken there and marks it; anywhere else on the page it is
  // refused, so a drop that misses the composer never replaces CodeAI with the file.
  const dropZone = page.locator('.instruction-composer');
  expect(await dragFile(page, '.instruction-composer', 'dragover')).toBe(true);
  await expect(dropZone).toHaveClass(/drop-target/);
  // Moving onto the text field inside it keeps the mark; leaving the composer clears it.
  await dragFile(page, '.instruction-composer', 'dragleave', '.instruction-composer textarea');
  await expect(dropZone).toHaveClass(/drop-target/);
  await dragFile(page, '.instruction-composer', 'dragleave');
  await expect(dropZone).not.toHaveClass(/drop-target/);
  expect(await dragFile(page, '.conversation-scroll', 'dragover')).toBe(true);
  expect(await dragFile(page, '.conversation-scroll', 'drop')).toBe(true);
  await expect(chips).toHaveCount(1);

  // A dropped image joins it, and a chip can be removed.
  await deliverImage(page, 'drop', 64, 48);
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(1)).toContainText('Image 2 · PNG · 64×48');
  await page.getByRole('button', { name: 'Remove image 2' }).click();
  await expect(chips).toHaveCount(1);

  // What is sent is drawn again within the bounds: a large image is scaled, a noisy one made to fit.
  await deliverImage(page, 'paste', 4096, 1024);
  await expect(chips.nth(1)).toContainText('Image 2 · PNG · 2048×512');
  await deliverImage(page, 'drop', 2048, 1200, { noise: true });
  await expect(chips).toHaveCount(3);
  const [, width, height, kilobytes] = (await chips.nth(2).textContent())!.match(/(\d+)×(\d+) · (\d+) KB/)!.map(Number);
  expect(Math.max(width, height)).toBeLessThanOrEqual(2048);
  expect(kilobytes).toBeLessThanOrEqual(768);

  // Text files now share this drop target with images; removing one leaves the images intact.
  await dropFile(page, 'notes.txt', 'text/plain');
  await expect(page.getByRole('button', { name: 'Remove file notes.txt' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove file notes.txt' }).click();
  await dropFile(page, 'broken.png', 'image/png');
  await expect(notices.filter({ hasText: 'That image could not be read.' })).toBeVisible();
  await expect(chips).toHaveCount(3);

  // A message carries four images and no fifth, even when two pastes race for the last place.
  await deliverImage(page, 'paste', 64, 48, { count: 2 });
  await expect(notices.filter({ hasText: 'A message carries at most 4 images.' })).toBeVisible();
  await expect(chips).toHaveCount(4);
  // With four waiting, another is refused before the browser spends any work decoding it.
  await page.evaluate(() => {
    const decode = window.createImageBitmap;
    Object.assign(window, { decodes: 0 });
    window.createImageBitmap = function counted(...args: unknown[]) {
      (window as unknown as { decodes: number }).decodes += 1;
      return Reflect.apply(decode, window, args);
    } as typeof createImageBitmap;
  });
  await deliverImage(page, 'paste', 64, 48);
  expect(await page.evaluate(() => (window as unknown as { decodes: number }).decodes)).toBe(0);
  await expect(chips).toHaveCount(4);
  for (const number of [4, 3, 2]) await page.getByRole('button', { name: `Remove image ${number}` }).click();
  await expect(chips).toHaveCount(1);

  // A mixed drop attaches both kinds; removing the text file preserves the image-only send below.
  await deliverImage(page, 'drop', 64, 48, { besideText: true });
  await expect(page.getByRole('button', { name: 'Remove file notes.txt' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove file notes.txt' }).click();
  await expect(chips).toHaveCount(2);
  await page.getByRole('button', { name: 'Remove image 2' }).click();
  await expect(chips).toHaveCount(1);

  // An image alone is a complete instruction, and the turn is given its file.
  await composer.fill('');
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.locator('.chat-message.assistant').last()).toContainText('Image files: image-1.png, image-attachments.json.');
  await expect(page.locator('.chat-message.user .message-attachments.image')).toHaveText('1 image attached');
  await expect(chips).toHaveCount(0);
  const stored = (await (await request.get(`/api/sessions/${session.id}`)).json()).session as PublicSession;
  expect(stored.version).toBe(8);
  expect(stored.messages[0]).toMatchObject({ role: 'user', imageAttachments: [{ mediaType: 'image/png' }] });
  // The record says what the message carried and holds none of it.
  expect(JSON.stringify(stored)).not.toContain('base64');

  // A failed send keeps the image with the draft.
  await deliverImage(page, 'paste', 64, 48);
  await expect(chips).toHaveCount(1);
  await composer.fill('Second look');
  let outages = 1;
  await page.route('**/api/agent/message', (route) => outages-- > 0
    ? route.fulfill({ status: 503, json: { error: 'Simulated outage.' } }) : route.fallback());
  await send.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Simulated outage.' })).toBeVisible();
  await expect(composer).toHaveValue('Second look');
  await expect(chips).toHaveCount(1);

  // A cancelled turn keeps it too. Retry restores the text, and asks for the image once none is waiting.
  await composer.fill('Wait for reload cancellation.');
  await send.click();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  // While the turn runs the composer takes no drop, and the file still never replaces the page.
  expect(await dragFile(page, '.instruction-composer', 'dragover')).toBe(true);
  await expect(dropZone).not.toHaveClass(/drop-target/);
  expect(await deliverImage(page, 'drop', 64, 48)).toBe(true);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const cancelled = page.locator('.chat-message.user.cancelled');
  await expect(cancelled).toHaveCount(1);
  await expect(cancelled.locator('.message-attachments.image')).toHaveText('1 image attached');
  await expect(chips).toHaveCount(1);
  // Retry with an image still waiting says nothing: that image goes with the retried text. The
  // notice would come in the same render as the restored text.
  await composer.fill('');
  await cancelled.getByRole('button', { name: 'Retry' }).click();
  await expect(composer).toHaveValue('Wait for reload cancellation.');
  expect(await notices.filter({ hasText: 'That message carried an image' }).count()).toBe(0);
  await page.getByRole('button', { name: 'Remove image 1' }).click();
  await composer.fill('');
  await cancelled.getByRole('button', { name: 'Retry' }).click();
  await expect(composer).toHaveValue('Wait for reload cancellation.');
  await expect(notices.filter({ hasText: 'That message carried an image' })).toBeVisible();
  await expect(chips).toHaveCount(0);
});

test('sends a transparent image on white, and refuses one it cannot bring within the bounds', async ({ page, request }) => {
  const { project } = await projectWith(request, `Image bounds ${Date.now()}`, 'alpha');
  await page.goto('/');
  await selectProject(page, project.name);
  const chips = page.locator('.attachment-chip.image');
  const notices = page.getByRole('region', { name: 'Notifications' }).locator('.toast');

  // A window screenshot with a transparent shadow, too large as PNG, becomes a JPEG on white, not black.
  await deliverImage(page, 'paste', 2048, 1200, { noise: true, transparent: true });
  await expect(chips).toHaveCount(1);
  await expect(chips.first()).toContainText('Image 1 · JPEG · 2048×1200');
  const [corner, ...noise] = await chipPixels(chips.first(), [[-1, -1], [10, 10], [350, 350], [690, 690]]);
  for (const channel of corner) expect(channel).toBeGreaterThan(245);
  // The white goes behind the pixels, not over them.
  expect(noise.some((pixel) => pixel.slice(0, 3).some((channel) => channel < 200))).toBe(true);

  // An original over 32 MB is refused before the browser decodes it.
  await dropFile(page, 'huge.png', 'image/png', 33 * 1024 * 1024);
  await expect(notices.filter({ hasText: 'That image is too large to attach.' })).toBeVisible();

  // So is one that no size or encoding brings within the byte bound.
  await replaceEncoder(page, 'oversized');
  await deliverImage(page, 'paste', 64, 48);
  await expect(notices.filter({ hasText: 'That image could not be made small enough to attach.' })).toBeVisible();
  await restoreEncoder(page);
  await expect(chips).toHaveCount(1);

  // The ladder: a JPEG the browser could not make is never taken for one, and an image is scaled to
  // three quarters and tried again down to the last quality.
  await replaceEncoder(page, 'ladder');
  await deliverImage(page, 'paste', 2048, 1000);
  await expect(chips.nth(1)).toContainText('Image 2 · JPEG · 1536×750');
  await restoreEncoder(page);
});

test('an Execute plan turn leaves the composer\'s images for the next message', async ({ page, request }) => {
  const { project, session } = await projectWith(request, `Image plan ${Date.now()}`, 'alpha');
  await page.goto('/');
  await selectProject(page, project.name);
  const composer = page.locator('.instruction-composer textarea');
  const chips = page.locator('.attachment-chip.image');
  const answers = page.locator('.chat-message.assistant');

  await chooseMode(page, 'Plan');
  await composer.fill('Plan the parser extraction.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const execute = page.getByRole('button', { name: 'Execute plan' });
  await expect(execute).toBeEnabled();

  // The image waits for the composed message; the plan's own turn (and Continue's) does not take it.
  // The fake Claude asks to edit a file in Agent mode; denied, it answers without listing its files,
  // so the record is the proof: the message holds no images and the session stays below version 8.
  await deliverImage(page, 'paste', 64, 48);
  await expect(chips).toHaveCount(1);
  await execute.click();
  await page.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(answers).toHaveCount(2);
  await expect(answers.last()).toContainText('Edit denied');
  await expect(chips).toHaveCount(1);
  const stored = (await (await request.get(`/api/sessions/${session.id}`)).json()).session as PublicSession;
  expect(stored.version).toBe(4);
  expect(stored.messages.filter((message) => message.role === 'user').at(-1)).toMatchObject({ mode: 'agent' });
  expect(stored.messages.filter((message) => message.role === 'user').at(-1)).not.toHaveProperty('imageAttachments');
});

test('takes a real file drag on the composer and refuses one anywhere else, with the conversation open or closed', async ({ page, request }, testInfo) => {
  const { project } = await projectWith(request, `Image drags ${Date.now()}`, 'alpha');
  await page.goto('/');
  await selectProject(page, project.name);
  const chips = page.locator('.attachment-chip.image');
  const conversationToggle = page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: /^Conversation/ });
  const file = await pngFile(page, testInfo.outputPath('screenshot.png'), 120, 80);
  await watchDrags(page);

  // The composer offers a copy, takes the drop, and clears its mark.
  await realDrag(page, page.locator('.instruction-composer textarea'), file);
  await expect(chips).toHaveCount(1);
  await expect(chips.first()).toContainText('Image 1 · PNG · 120×80');
  await expect(page.locator('.instruction-composer')).not.toHaveClass(/drop-target/);
  expect(await takeDrags(page)).toEqual(['dragover cancelled copy', 'drop cancelled']);

  // A drop that misses it is refused: nothing is offered, so the drop never happens.
  await realDrag(page, page.locator('.conversation-scroll'), file);
  expect(await takeDrags(page)).toEqual(['dragover cancelled none']);

  // With the conversation closed the composer is gone, and the image waiting in it must not be lost.
  await conversationToggle.click();
  await expect(page.locator('.instruction-composer')).toHaveCount(0);
  await realDrag(page, page.locator('.canvas-workspace'), file);
  expect(await takeDrags(page)).toEqual(['dragover cancelled none']);
  await conversationToggle.click();
  await expect(chips).toHaveCount(1);
});


/** Draw across the centre of the image and return one point in its canonical pixel coordinates. */
async function drawOnImage(page: Page): Promise<[number, number]> {
  await page.getByRole('button', { name: 'Pen (P)' }).click();
  const ink = page.locator('svg.ink-layer');
  const box = (await ink.boundingBox())!;
  await page.mouse.move(box.x + box.width * .3, box.y + box.height * .5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .6, box.y + box.height * .5, { steps: 8 });
  await page.mouse.up();
  const mark = ink.locator('polyline[data-mark-id]');
  await expect(mark).toHaveCount(1);
  const points = (await mark.getAttribute('points'))!.split(' ');
  expect(points.length).toBeGreaterThan(1);
  return points[Math.floor(points.length / 2)].split(',').map(Number) as [number, number];
}

async function imagePixels(page: Page, dataUrl: string, points: Array<[number, number]>) {
  return page.evaluate(async ({ dataUrl, points }) => {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return points.map(([x, y]) => Array.from(context.getImageData(Math.round(x), Math.round(y), 1, 1).data));
  }, { dataUrl, points });
}

test('opens screenshot chips on the canvas, keeps ink per image and session, and sends the marked pixels', async ({ page, request }) => {
  test.setTimeout(90_000);
  const { project, session } = await projectWith(request, `Image canvas ${Date.now()}`, 'alpha');
  const neighbour = await projectWith(request, `Image neighbour ${Date.now()}`, 'alpha');
  await page.goto('/');
  await selectProject(page, project.name);
  await chooseMode(page, 'Ask');
  // Leave a durable sketch attached: the image frame must not replace its export viewport.
  await page.getByRole('button', { name: /Start a sketch/ }).click();
  await expect(page.locator('.sketch-sheet')).toBeVisible();
  await page.getByRole('button', { name: 'Spatial', exact: true }).click();
  const canvasToggle = page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: 'Canvas', exact: true });
  await canvasToggle.click();
  await deliverImage(page, 'paste', 320, 200);
  await deliverImage(page, 'drop', 160, 100);
  const chips = page.locator('.attachment-chip.image');
  await expect(chips).toHaveCount(2);
  const original = (await chips.first().locator('img').getAttribute('src'))!;
  const second = (await chips.nth(1).locator('img').getAttribute('src'))!;
  // Clicking the thumbnail itself opens even the hidden, previously spatial canvas.
  await chips.first().locator('img').click();
  await expect(canvasToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.canvas-titleblock strong')).toHaveText('Image 1');
  await expect(page.locator('.mermaid-layer image')).toHaveAttribute('href', original);
  await expect(page.locator('.ink-layer')).toHaveAttribute('viewBox', '0 0 320 200');
  const point = await drawOnImage(page);
  await page.getByRole('button', { name: 'Undo drawing', exact: true }).click();
  await expect(page.locator('[data-mark-id]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo drawing', exact: true }).click();
  await expect(page.locator('[data-mark-id]')).toHaveCount(1);
  const markId = (await page.locator('[data-mark-id]').getAttribute('data-mark-id'))!;

  await page.getByRole('button', { name: 'Open image 2 on canvas' }).click();
  await expect(page.locator('.canvas-titleblock strong')).toHaveText('Image 2');
  await expect(page.locator('[data-mark-id]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open image 1 on canvas' }).click();
  await expect(page.locator('[data-mark-id]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Back to canvas' }).click();
  await expect(page.getByRole('button', { name: 'Spatial', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Flat', exact: true }).click();
  await expect(page.locator('.sketch-sheet')).toBeVisible();
  await expect(page.locator('[data-mark-id]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open image 1 on canvas' }).click();

  await selectProject(page, neighbour.project.name);
  await expect(chips).toHaveCount(0);
  await selectProject(page, project.name);
  await expect(page.locator('.canvas-titleblock strong')).toHaveText('Image 1');
  await expect(page.locator('[data-mark-id]')).toHaveCount(1);
  const device = await page.evaluate(() => JSON.stringify(Object.values(localStorage)));
  expect(device).not.toContain('base64');
  expect(device).not.toContain(markId);

  const posted = page.waitForRequest('**/api/agent/message');
  await page.locator('.instruction-composer textarea').fill('Look at the marked screenshot.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const payload = (await posted).postDataJSON() as {
    imageAttachments: Array<{ dataUrl: string }>;
    diagramAttachments: Array<{ viewport: { viewBox: number[] } }>;
  };
  expect(payload.imageAttachments).toHaveLength(2);
  expect(payload.imageAttachments[1].dataUrl).toBe(second);
  expect(payload.diagramAttachments[0].viewport.viewBox).toEqual([0, 0, 1600, 1000]);
  const composite = payload.imageAttachments[0].dataUrl;
  expect(composite).not.toBe(original);
  expect(Buffer.from(composite.split(',')[1], 'base64').length).toBeLessThanOrEqual(768 * 1024);
  const [background, ink] = await imagePixels(page, composite, [[10, 10], point]);
  expect(background).toEqual([51, 102, 204, 255]);
  expect(ink[0]).toBeGreaterThan(150);
  expect(ink[2]).toBeLessThan(100);
  await expect(page.locator('.chat-message.assistant').last()).toContainText('image-1.png');
  await expect(chips).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Back to canvas' })).toHaveCount(0);
  const stored = (await (await request.get(`/api/sessions/${session.id}`)).json()).session as PublicSession;
  const message = stored.messages.find((message) => message.role === 'user')!;
  expect(message).toMatchObject({ imageAttachments: [
    { mediaType: 'image/png', bytes: Buffer.from(composite.split(',')[1], 'base64').length },
    { mediaType: 'image/png' },
  ] });
  expect(Object.values(stored.annotations).every((annotation) => !annotation.marks.length)).toBe(true);
  expect(JSON.stringify(stored)).not.toContain('base64');
});

test('keeps screenshot pixels and ink after export failure, rejection, and cancellation; Remove closes it', async ({ page, request }) => {
  test.setTimeout(90_000);
  const { project } = await projectWith(request, `Image canvas failures ${Date.now()}`, 'alpha');
  await page.goto('/');
  await selectProject(page, project.name);
  await chooseMode(page, 'Ask');
  await deliverImage(page, 'paste', 320, 200);
  const chip = page.locator('.attachment-chip.image');
  await expect(chip).toHaveCount(1);
  const original = await chip.locator('img').getAttribute('src');
  await page.getByRole('button', { name: 'Open image 1 on canvas' }).click();
  await drawOnImage(page);
  const composer = page.locator('.instruction-composer textarea');
  await composer.fill('Keep this drawing.');
  const send = page.getByRole('button', { name: 'Send', exact: true });
  // Fail the final bounded preparation, after the SVG composite has been encoded successfully.
  await page.evaluate(() => {
    const encode = HTMLCanvasElement.prototype.toDataURL;
    let calls = 0;
    Object.assign(window, { restoreEncoder: () => { HTMLCanvasElement.prototype.toDataURL = encode; } });
    HTMLCanvasElement.prototype.toDataURL = function(type?: string, quality?: number) {
      calls += 1;
      return calls === 1 ? encode.call(this, type, quality) : `data:${type};base64,${'A'.repeat(1_100_000)}`;
    };
  });
  let posts = 0;
  page.on('request', (request) => { if (request.url().endsWith('/api/agent/message')) posts += 1; });
  await send.click();
  await expect(page.getByRole('region', { name: 'Notifications' })).toContainText('could not be made small enough');
  expect(posts).toBe(0);
  await restoreEncoder(page);
  await expect(composer).toHaveValue('Keep this drawing.');
  await expect(chip.locator('img')).toHaveAttribute('src', original!);
  await expect(page.locator('[data-mark-id]')).toHaveCount(1);
  let outages = 1;
  await page.route('**/api/agent/message', (route) => outages-- > 0
    ? route.fulfill({ status: 503, json: { error: 'Drawing test outage.' } }) : route.fallback());
  await send.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Drawing test outage.' })).toBeVisible();
  await expect(page.locator('[data-mark-id]')).toHaveCount(1);
  await expect(composer).toHaveValue('Keep this drawing.');
  await composer.fill('Wait for reload cancellation.');
  await send.click();
  await expect(page.getByRole('button', { name: 'Open image 1 on canvas' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Pen (P)' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Undo drawing' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Clear all ink' })).toBeDisabled();
  // Global shortcuts and the pointer must not bypass the pending image's edit lock.
  await page.getByRole('button', { name: 'Fit', exact: true }).focus();
  await page.keyboard.press('Control+z');
  await page.locator('svg.ink-layer').click({ position: { x: 100, y: 80 } });
  await expect(page.locator('[data-mark-id]')).toHaveCount(1);
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancel).toBeEnabled();
  await cancel.click();
  await expect(page.locator('.chat-message.user.cancelled')).toHaveCount(1);
  await expect(page.locator('[data-mark-id]')).toHaveCount(1);
  await expect(chip.locator('img')).toHaveAttribute('src', original!);
  await page.getByRole('button', { name: 'Remove image 1' }).click();
  await expect(chip).toHaveCount(0);
  await expect(page.locator('[data-mark-id]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Back to canvas' })).toHaveCount(0);
});


test('opens screenshot drawing above the conversation overlay on a narrow screen', async ({ page, request }) => {
  const { project } = await projectWith(request, `Narrow image canvas ${Date.now()}`, 'alpha');
  await page.setViewportSize({ width: 600, height: 800 });
  await page.goto('/');
  await selectProject(page, project.name);
  await deliverImage(page, 'paste', 320, 200);
  await expect(page.locator('.attachment-chip.image')).toHaveCount(1);
  await page.getByRole('button', { name: 'Open image 1 on canvas' }).click();
  await expect(page.getByRole('complementary', { name: 'Conversation' })).toHaveCount(0);
  await expect(page.locator('.canvas-titleblock strong')).toHaveText('Image 1');
  await drawOnImage(page);
  await page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: /^Conversation/ }).click();
  await expect(page.locator('.attachment-chip.image')).toContainText('1 mark');
});


test('keeps the sending session canvas frame when navigation occurs during image export', async ({ page, request }) => {
  const { project, session } = await projectWith(request, `Image export navigation ${Date.now()}`, 'alpha');
  const neighbour = await projectWith(request, `Image export other ${Date.now()}`, 'alpha');
  const agent = neighbour.session.participants.find((participant) => participant.kind === 'agent')!;
  const answer = await request.post('/api/agent/message', { data: {
    sessionId: neighbour.session.id, messageId: crypto.randomUUID(), participantId: agent.id,
    text: 'Draw a simple architecture', mode: 'ask', diagramAttachments: [],
  } });
  expect(answer.ok()).toBe(true);
  await page.goto('/');
  await selectProject(page, project.name);
  await chooseMode(page, 'Ask');
  await page.getByRole('button', { name: /Start a sketch/ }).click();
  await expect(page.locator('.sketch-sheet')).toBeVisible();
  await deliverImage(page, 'paste', 320, 200);
  await expect(page.locator('.attachment-chip.image')).toHaveCount(1);
  await page.getByRole('button', { name: 'Open image 1 on canvas' }).click();
  await drawOnImage(page);
  await page.getByRole('button', { name: 'Back to canvas' }).click();
  await expect(page.locator('.sketch-sheet')).toBeVisible();
  // Hold the marked image's final decode while another session renders its own canvas frame.
  await page.evaluate(() => {
    const decode = window.createImageBitmap;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    Object.assign(window, { imageExportWaiting: false, releaseImageExport: release });
    window.createImageBitmap = async function (...args: unknown[]) {
      Object.assign(window, { imageExportWaiting: true });
      await gate;
      window.createImageBitmap = decode;
      return Reflect.apply(decode, window, args);
    } as typeof createImageBitmap;
  });
  const posted = page.waitForRequest('**/api/agent/message');
  await page.locator('.instruction-composer textarea').fill('Use this screenshot and sketch.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { imageExportWaiting: boolean }).imageExportWaiting)).toBe(true);
  await selectProject(page, neighbour.project.name);
  await expect(page.locator('.mermaid-layer svg')).toBeVisible();
  expect(await page.locator('.ink-layer').getAttribute('viewBox')).not.toBe('0 0 1600 1000');
  await page.evaluate(() => (window as unknown as { releaseImageExport(): void }).releaseImageExport());
  const payload = (await posted).postDataJSON();
  expect(payload.sessionId).toBe(session.id);
  expect(payload.diagramAttachments[0].viewport.viewBox).toEqual([0, 0, 1600, 1000]);
  await selectProject(page, project.name);
  await expect(page.locator('.chat-message.assistant').last()).toBeVisible();
  await expect(page.locator('.attachment-chip.image')).toHaveCount(0);
});
