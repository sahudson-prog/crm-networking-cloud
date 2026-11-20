// Against the already running synthetic preview; never launches a product runtime.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');
const base = process.argv[3] || 'http://127.0.0.1:3103';
if (new URL(base).hostname !== '127.0.0.1') throw Error('Only the local synthetic preview is supported');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-open-render-tests-'));

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let checks = 0;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const goto = (view, scenario) => page.goto(`${base}/?view=${view}&scenario=${scenario}`);
    const mutations = () => page.evaluate(() => window.fixtureCalls.filter(call => call.name === 'admin_set_public_registration_v1'));
    const save = () => page.getByRole('button', { name: 'Guardar registro libre', exact: true });
    const refresh = () => page.getByRole('button', { name: 'Consultar estado', exact: true });
    const toggle = () => page.getByRole('switch', { name: 'Permitir registro sin invitación' });

    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const scenario of ['on', 'off', 'error']) {
        await goto('landing', scenario);
        await page.waitForFunction(() => window.fixtureCalls.some(call => call.name === 'public_registration_status_v1'));
        await page.getByRole('link', { name: scenario === 'on' ? 'Crear mi cuenta' : 'Entrar con mi invitación', exact: true }).waitFor();
        assert.equal(await page.getByRole('link', { name: 'Entrar', exact: true }).getAttribute('href'), '/ingresar');
        const closedMessage = page.getByText('¿Sin invitación? La mejor recomendación es la de alguien que ya la usa: pídésela.', { exact: true });
        assert.equal(await closedMessage.count(), scenario === 'on' ? 0 : 1);
        assert.equal(await page.getByText(/registro libre está disponible|No necesitas una invitación/i).count(), 0);
        await page.locator('.landing-cta svg').waitFor();
        await page.waitForFunction(() => [...document.images].every(img => img.complete && img.naturalWidth > 0));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: path.join(output, `landing-${scenario}-${width}.png`), fullPage: true });
        checks++;
      }
    }

    for (const scenario of ['on', 'off', 'error']) {
      await page.evaluate(() => sessionStorage.clear());
      await goto('login', scenario);
      await page.getByRole('status').filter({ hasText: scenario === 'on' ? 'Puedes crear tu cuenta' : scenario === 'off' ? 'registro libre está cerrado' : 'No pudimos confirmar' }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Continuar con Google', exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: 'Continuar con email', exact: true }).isDisabled(), true);
      await page.getByRole('checkbox').check();
      assert.equal(await page.getByRole('button', { name: 'Continuar con Google', exact: true }).isEnabled(), true);
      await page.locator('summary').filter({ hasText: 'Continuar con email' }).waitFor();
      assert.equal(await page.getByText('Private fixture must remain unmounted').count(), 0);
      checks++;
    }

    for (const scenario of ['error', 'read-denied', 'permission-error', 'denied']) {
      await goto('admin', scenario);
      await page.getByText('Estado no disponible.', { exact: true }).waitFor();
      assert.equal(await refresh().isEnabled(), true);
      if (scenario === 'denied') assert.equal(await toggle().count(), 0);
      else {
        assert.equal(await toggle().isDisabled(), true);
        assert.equal(await save().isDisabled(), true);
      }
      assert.equal((await mutations()).length, 0);
      await page.screenshot({ path: path.join(output, `admin-${scenario}.png`), fullPage: true });
      await page.evaluate(() => window.fixtureRecover());
      await refresh().click();
      await page.getByText('Estado actual: desactivado.', { exact: true }).waitFor();
      assert.equal(await toggle().isEnabled(), true);
      checks++;
    }

    for (const scenario of ['on', 'off']) {
      await goto('admin', scenario);
      await page.getByText(`Estado actual: ${scenario === 'on' ? 'activado' : 'desactivado'}.`, { exact: true }).waitFor();
      assert.equal(await toggle().isChecked(), scenario === 'on');
      assert.equal(await save().isDisabled(), true);
      await toggle().click();
      page.once('dialog', dialog => dialog.dismiss());
      await save().click();
      assert.equal((await mutations()).length, 0);
      page.once('dialog', dialog => dialog.accept());
      await save().click();
      await page.getByText('Cambio confirmado.', { exact: true }).waitFor();
      assert.deepEqual((await mutations()).map(call => call.args), [{ p_enabled: scenario !== 'on', p_expected_revision: 4 }]);
      assert.equal(await toggle().isChecked(), scenario !== 'on');
      await page.screenshot({ path: path.join(output, `admin-saved-${scenario}.png`), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      checks++;
    }

    await goto('admin', 'timeout');
    await page.getByText('Estado actual: desactivado.', { exact: true }).waitFor();
    await toggle().check();
    page.once('dialog', dialog => dialog.accept());
    await save().click();
    await page.getByText('La escritura sigue pendiente.', { exact: false }).waitFor({ timeout: 15000 });
    assert.equal(await toggle().isDisabled(), true);
    assert.equal(await save().isDisabled(), true);
    await refresh().click();
    await page.getByText('La escritura sigue pendiente.', { exact: false }).waitFor();
    assert.equal(await save().isDisabled(), true);
    assert.equal((await mutations()).length, 1);
    await page.screenshot({ path: path.join(output, 'admin-pending-timeout.png'), fullPage: true });
    await page.evaluate(async () => { window.fixtureReleaseWrite(); await new Promise(resolve => setTimeout(resolve, 30)); });
    await refresh().click();
    await page.getByText('Estado actual: activado.', { exact: true }).waitFor();
    assert.equal(await toggle().isEnabled(), true);
    assert.equal(await toggle().isChecked(), true);
    assert.equal((await mutations()).length, 1);
    checks++;

    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'PASS', renderedChecks: checks, screenshots: output,
      coverage: 'real landing ON/OFF/error desktop/mobile; actual login controls; admin denied/error/recovery; confirmation cancel/save; pending timeout reread and late commit' }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
