import { chromium } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';
import * as path from 'path';

loadDotenv({ path: '.env.local' });
loadDotenv();

async function run() {
    const email = process.env.E2E_USER_EMAIL;
    const password = process.env.E2E_USER_PASSWORD;
    const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:3000';

    console.log(`Using credentials: email=${email}, baseUrl=${baseUrl}`);

    if (!email || !password) {
        console.error('Missing E2E credentials in environment variables');
        process.exit(1);
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on('console', msg => {
        console.log(`[BROWSER CONSOLE] [${msg.type()}] ${msg.text()}`);
    });

    page.on('pageerror', err => {
        console.error(`[BROWSER ERROR] ${err.message}`);
        console.error(err.stack);
    });

    try {
        console.log('Navigating to login page...');
        await page.goto(`${baseUrl}/login`);
        await page.waitForSelector('input[type="email"]', { timeout: 10000 });
        await page.fill('input[type="email"]', email);
        await page.fill('input[type="password"]', password);
        await page.click('button[type="submit"]');

        console.log('Waiting for redirection to /hub...');
        await page.waitForURL(url => url.pathname !== '/login', { timeout: 15000 });
        console.log(`Redirected to: ${page.url()}`);

        console.log('Navigating to /messages...');
        await page.goto(`${baseUrl}/messages`);
        await page.waitForTimeout(5000);

        console.log('Listing all conversation rows:');
        const rows = page.locator('[data-testid^="conversation-row-"]');
        const count = await rows.count();
        for (let i = 0; i < count; i++) {
            const text = await rows.nth(i).textContent();
            const id = await rows.nth(i).getAttribute('data-testid');
            console.log(`Row ${i}: name="${text?.trim().replace(/\s+/g, ' ')}", testid="${id}"`);
        }

        console.log('Finding and clicking "Lakshmi CH" row...');
        const lakshmiRow = page.locator('[data-testid^="conversation-row-"]').filter({ hasText: 'Lakshmi CH' }).first();
        if (await lakshmiRow.count() > 0) {
            await lakshmiRow.click();
            console.log('Clicked Lakshmi CH row, waiting for messages to load...');
            await page.waitForTimeout(5000);

            // Take a screenshot
            const screenshotPath = path.join(process.cwd(), 'scratch/lakshmi_screenshot.png');
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`Screenshot saved to ${screenshotPath}`);

            // Dump HTML of Virtuoso viewport and messages
            const virtuosoHtml = await page.evaluate(() => {
                const el = document.querySelector('[data-viewport-type="element"]');
                return el ? el.outerHTML : 'Virtuoso viewport not found';
            });
            console.log('Virtuoso HTML:', virtuosoHtml);

            const messageRows = await page.locator('.msg-message-row').count();
            console.log(`Number of message rows found: ${messageRows}`);
            for (let i = 0; i < messageRows; i++) {
                const text = await page.locator('.msg-message-row').nth(i).textContent();
                console.log(`Msg ${i}: "${text?.trim()}"`);
            }
        } else {
            console.warn('Could not find Lakshmi CH row in the list');
        }

    } catch (err) {
        console.error('Error during execution:', err);
    } finally {
        await browser.close();
    }
}

run();
