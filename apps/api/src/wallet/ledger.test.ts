import { it, expect } from 'vitest';
import { Ledger } from './ledger';
it('rejects unbalanced, empty and duplicate-account journal legs before querying', async () => {
  const ledger = new Ledger(); const manager = {} as never;
  await expect(ledger.post(manager,'k','BET','m',[])).rejects.toThrow('Invalid balanced entry');
  await expect(ledger.post(manager,'k','BET','m',[{account:'a',amount:-10n},{account:'b',amount:9n}])).rejects.toThrow();
  await expect(ledger.post(manager,'k','BET','m',[{account:'a',amount:-10n},{account:'a',amount:10n}])).rejects.toThrow();
});
