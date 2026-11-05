import { test, expect } from '@playwright/test';
test('a solo shot settles and can be independently verified in the browser', async ({ page }) => {
    await page.goto('/solo');
    const start = page.getByRole('button', { name: 'Start solo run' });
    await expect(start).toBeEnabled();
    const hash = await page.locator('.seed-box code').innerText();
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    await start.click();
    await page.getByRole('button', { name: 'Shoot left', exact: true }).click();
    await expect(async () => { if (await page.getByRole('button', { name: 'Verify this run' }).isVisible())
        return; await expect(page.getByRole('button', { name: /^Cash out/ })).toBeEnabled({ timeout: 1000 }); }).toPass({ timeout: 10000 });
    const cashout = page.getByRole('button', { name: /^Cash out/ });
    if (await cashout.isVisible())
        await cashout.click();
    await page.getByRole('button', { name: 'Verify this run' }).click();
    await expect(page.getByLabel('Original server seed hash')).toHaveValue(hash);
    await page.getByRole('button', { name: 'Verify this shot' }).click();
    await expect(page.getByText('Seed commitment matches', { exact: true })).toBeVisible();
    await expect(page.getByText(/Keeper’s zone:/)).toBeVisible();
});
