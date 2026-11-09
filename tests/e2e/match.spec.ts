import { test, expect } from '@playwright/test';
test('a guest starts practice directly, reloads, verifies fairness and sees settled funds', async ({ page }) => {
    await page.goto('/');
    const practice = page.getByRole('button', { name: 'Practice vs bot', exact: true });
    await expect(practice).toBeEnabled();
    await expect(page.getByTestId('balance')).toHaveText('1,000');
    await practice.click();
    await expect(page.getByTestId('scoreboard')).toBeVisible();
    await expect(page.getByText('Bot opponent', { exact: false })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('scoreboard')).toBeVisible();
    await expect(page.getByTestId('balance')).toHaveText('990');
    for (let i = 0; i < 120; i++) {
        if (await page.getByTestId('match-result').isVisible())
            break;
        const choice = page.getByRole('button', { name: /^(Shoot|Dive) (left|centre|right)$/ }).nth(i % 3);
        if (await choice.isEnabled({ timeout: 500 }).catch(() => false))
            await choice.click();
        await page.waitForTimeout(300);
    }
    await expect(page.getByTestId('match-result')).toBeVisible({ timeout: 90000 });
    await page.getByText('Inspect match fairness', { exact: true }).click();
    await page.getByRole('button', { name: 'Verify match transcript' }).click();
    await expect(page.getByText('Verified: seed, commitments and timeout choices match.')).toBeVisible();
    await expect(page.getByTestId('balance')).toHaveText(/^(990|1,009\.4)$/);
    if (process.env.CAPTURE_PREVIEW)
        await page.screenshot({ path: 'docs/preview-match.png', fullPage: true });
    await page.getByRole('button', { name: 'View wallet ledger' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/^stakes locked/)).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('button', { name: 'View wallet ledger' })).toBeFocused();
});
