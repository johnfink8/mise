import { test, expect } from '@playwright/test';

const INITIAL_PROMPT = 'something cozy for a cozy thursday night';
const FOLLOW_UP_PROMPT = 'shorter than 100 minutes';

const FIRST_CYCLE_TITLES = [
  'The Quiet Hours',
  'Letters from the Garden',
  'Sunday Bakers',
  'Lighthouse Winter',
  'Harvest Light',
];

const SECOND_CYCLE_TITLES = [
  'The Manager',
  'Eight Saturdays',
  'Soft Open',
  'Two Birds, One Yard',
  'Wool & Wire',
];

test('home → recommendation cycle → follow-up replaces recs', async ({ page }) => {
  await page.goto('/');

  // Catalog is empty on first boot; the home page kicks off refreshFromPlex
  // automatically. Wait for the eyebrow to confirm 50 movies are indexed —
  // first run also has to embed all 50 against bge-small-en-v1.5.
  await expect(page.getByText('50 films catalogued')).toBeVisible({ timeout: 180_000 });

  const initialInput = page.getByPlaceholder(/feel-good 90s comedy/i);
  await initialInput.fill(INITIAL_PROMPT);
  await initialInput.press('Enter');

  await page.waitForURL(/\/sessions\/[0-9a-f-]+/i, { timeout: 30_000 });

  // Status pill flips THINKING… → "5 RESULTS" once the cycle completes.
  await expect(page.getByText('5 RESULTS')).toBeVisible({ timeout: 90_000 });

  for (const title of FIRST_CYCLE_TITLES) {
    await expect(page.getByRole('heading', { name: new RegExp(`^${escapeRegExp(title)}`) })).toBeVisible();
  }

  // Follow-up: the placeholder is whatever the prior cycle's
  // `follow_up_suggestion` was (set in the fixture to this exact string).
  const followUpInput = page.getByPlaceholder(FOLLOW_UP_PROMPT);
  await followUpInput.fill(FOLLOW_UP_PROMPT);
  await followUpInput.press('Enter');

  // Wait for the new picks to appear — also implicitly verifies the prior set
  // got replaced, since SessionView only renders the latest cycle.
  for (const title of SECOND_CYCLE_TITLES) {
    await expect(page.getByRole('heading', { name: new RegExp(`^${escapeRegExp(title)}`) })).toBeVisible({ timeout: 90_000 });
  }
  for (const title of FIRST_CYCLE_TITLES) {
    await expect(page.getByRole('heading', { name: new RegExp(`^${escapeRegExp(title)}`) })).toHaveCount(0);
  }

  await expect(page.getByText('5 RESULTS')).toBeVisible();
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
