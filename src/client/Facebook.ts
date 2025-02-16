import { Browser, DEFAULT_INTERCEPT_RESOLUTION_PRIORITY } from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import UserAgent from "user-agents";
import { Server } from "proxy-chain";
import logger from "../config/logger";
import { runAgent } from "../Agent";
import { getFacebookCommentSchema } from "../Agent/schema";
import { FBpassword, FBusername } from "../secret";
import { Facebook_cookiesExist, loadCookies, saveCookies } from "../utils";

puppeteer.use(StealthPlugin());
puppeteer.use(
    AdblockerPlugin({
        interceptResolutionPriority: DEFAULT_INTERCEPT_RESOLUTION_PRIORITY,
    })
);

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runFacebook() {
    const server = new Server({ port: 8000 });
    await server.listen();
    const proxyUrl = `http://localhost:8000`;
    const browser = await puppeteer.launch({
        headless: false,
        args: [
            `--proxy-server=${proxyUrl}`,
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ],
    });

    const page = await browser.newPage();
    const cookiesPath = "./cookies/Facebookcookies.json";

    const checkCookies = await Facebook_cookiesExist();
    logger.info(`Checking cookies existence: ${checkCookies}`);

    if (checkCookies) {
        const cookies = await loadCookies(cookiesPath);
        await page.setCookie(...cookies);
        logger.info('Cookies loaded and set on the page.');

        await page.goto("https://www.facebook.com/", { waitUntil: 'networkidle2' });
        
        const isLoggedIn = await page.$eval("a[href='/feed/']", el => !!el);
        if (isLoggedIn) {
            logger.info("Login verified with cookies.");
            await page.screenshot({ path: "facebook_logged_in.png" });
        } else {
            logger.warn("Cookies invalid or expired. Logging in again...");
            await facebookLoginWithCredentials(page, browser);
        }
    } else {
        await facebookLoginWithCredentials(page, browser);
    }

    await page.goto("https://www.facebook.com/");
    await interactWithFacebookPosts(page);

    await browser.close();
    await server.close(true);
}

const facebookLoginWithCredentials = async (page: any, browser: Browser) => {
    try {
        await page.goto("https://www.facebook.com/", { 
            waitUntil: 'networkidle2',
            timeout: 60000 
        });

        await page.waitForSelector('#email', { visible: true, timeout: 30000 });
        await page.type('#email', FBusername, { delay: 100 });
        await page.type('#pass', FBpassword, { delay: 150 });
        
        await Promise.all([
            page.click('button[name="login"]'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 })
        ]);

        const loginSuccess = await page.$("a[href='/feed/']");
        if (!loginSuccess) throw new Error("Login failed");

        const cookies = await browser.cookies();
        await saveCookies("./cookies/Facebookcookies.json", cookies);
    } catch (error) {
        logger.error("Facebook login error:", error);
        throw error;
    }
}

async function interactWithFacebookPosts(page: any) {
    let postIndex = 1;
    const maxPosts = 50;

    while (postIndex <= maxPosts) {
        try {
            const postSelector = `div[role="article"]:nth-of-type(${postIndex})`;
            
            if (!(await page.$(postSelector))) {
                console.log("No more posts found. Exiting loop...");
                break;
            }

            const likeButtonSelector = `${postSelector} [aria-label="Like"]`;
            const likeButton = await page.$(likeButtonSelector);
            
            if (likeButton) {
                console.log(`Liking post ${postIndex}...`);
                await likeButton.click();
                console.log(`Post ${postIndex} liked.`);
            }

            const commentBoxSelector = `${postSelector} [aria-label="Write a comment"]`;
            const commentBox = await page.$(commentBoxSelector);
            
            if (commentBox) {
                console.log(`Commenting on post ${postIndex}...`);
                await commentBox.click();
                
                const activeCommentSelector = 'div[role="textbox"]';
                await page.waitForSelector(activeCommentSelector);
                
                const prompt = `Craft a thoughtful Facebook comment...`;
                const schema = getFacebookCommentSchema();
                const result = await runAgent(schema, prompt);
                
                await page.type(activeCommentSelector, result[0]?.comment);
                await page.keyboard.press('Enter');
                console.log(`Comment posted on post ${postIndex}.`);
            }

            const waitTime = Math.floor(Math.random() * 5000) + 5000;
            console.log(`Waiting ${waitTime/1000}s before next post...`);
            await delay(waitTime);

            await page.evaluate(() => {
                window.scrollBy(0, window.innerHeight);
            });

            postIndex++;
        } catch (error) {
            logger.error(`Post ${postIndex} interaction failed:`, error);
            await page.screenshot({ path: `facebook_error_${postIndex}.png` });
            break;
        }
    }
}

export { runFacebook }; 