import { test, expect } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';

test('two authenticated guests recover a pending commitment and settle one shared result', async ({ page, request }) => {
    const api = process.env.API_URL || 'http://localhost:3001';
    const rivalResponse = await request.post(`${api}/session`, { data: {} });
    expect(rivalResponse.ok()).toBeTruthy();
    const rival = await rivalResponse.json();
    const rivalHeaders = { Authorization: `Bearer ${rival.token}` };
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Find match', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'S 25', exact: true }).click();
    await Promise.all([
        page.getByRole('button', { name: 'Find match', exact: true }).click(),
        request.post(`${api}/queue`, { headers: rivalHeaders, data: { stake: 2500 } }).then(r => expect(r.ok()).toBeTruthy())
    ]);
    await expect(page.getByTestId('scoreboard')).toBeVisible();
    await expect(page.locator('.arena-format')).toContainText('Live PvP');
    const token = await page.evaluate(() => localStorage.getItem('spotkick:token'));
    const headers = { Authorization: `Bearer ${token}` };
    const identity = await (await request.get(`${api}/me`, { headers })).json();
    const matchId = identity.active_game.slice('match:'.length);
    const readMatch = async () => {
        const response = await request.get(`${api}/matches/${matchId}`, { headers });
        expect(response.ok()).toBeTruthy();
        return response.json();
    };
    await page.getByRole('button', { name: /^(Shoot|Dive) left$/ }).click();
    await expect(page.getByText('Locked in. Waiting for your opponent…', { exact: true })).toBeVisible();
    const originalHash = (await readMatch()).commitments[identity.id];
    await page.reload();
    await expect(page.getByTestId('scoreboard')).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Shoot|Dive) left$/ })).toBeDisabled();
    expect((await readMatch()).commitments[identity.id]).toBe(originalHash);
    for (let exchange = 0; exchange < 6; exchange++) {
        if (exchange > 0) {
            await expect.poll(async () => {
                const state = await readMatch();
                return state.exchange === exchange && state.phase.endsWith('_COMMIT');
            }).toBe(true);
            await page.getByRole('button', { name: /^(Shoot|Dive) left$/ }).click();
        }
        const state = await readMatch();
        const choice = state.players[state.shooter].id === rival.id ? 'left' : 'centre';
        const salt = randomBytes(32).toString('hex');
        const hash = createHash('sha256').update(JSON.stringify([matchId, Math.floor(exchange / 2) + 1, exchange, rival.id, choice, salt])).digest('hex');
        const committed = await request.post(`${api}/matches/commit`, { headers: rivalHeaders, data: { matchId, exchange, hash } });
        expect(committed.ok()).toBeTruthy();
        const revealed = await request.post(`${api}/matches/reveal`, { headers: rivalHeaders, data: { matchId, exchange, choice, salt } });
        expect(revealed.ok()).toBeTruthy();
        await expect.poll(async () => (await readMatch()).results.length).toBe(exchange + 1);
    }
    const terminal = await readMatch();
    expect(terminal.phase).toBe('SETTLED');
    expect(terminal.winner).toBe(identity.id);
    expect(terminal.payout).toBe(4850);
    expect(terminal.audit[0].commitments[identity.id]).toBe(originalHash);
    expect(terminal.results[0].timeouts).toEqual([]);
    await expect(page.getByTestId('match-result')).toBeVisible();
    await expect(page.getByTestId('balance')).toHaveText('1,023.5');
    const rivalMe = await (await request.get(`${api}/me`, { headers: rivalHeaders })).json();
    expect(rivalMe.balance).toBe(97500);
    await page.getByText('Inspect match fairness', { exact: true }).click();
    await page.getByRole('button', { name: 'Verify match transcript' }).click();
    await expect(page.getByText('Verified: seed, commitments and timeout choices match.')).toBeVisible();
});
