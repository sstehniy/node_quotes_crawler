/* eslint-disable no-async-promise-executor */
import puppeteer from "puppeteer";
import fs from "fs/promises";

class PromiseQueue<T> {
  limit: number;
  queue: {
    promiseGenerator: () => Promise<T>;
    resolve: (result: T) => void;
    reject: (error: Error) => void;
  }[];
  activeCount: number;
  constructor(limit: number) {
    this.limit = limit;
    this.queue = [];
    this.activeCount = 0;
  }

  add(promiseGenerator: () => Promise<T>): Promise<T> {
    return new Promise<T>(
      (resolve: (result: T) => void, reject: (error: Error) => void) => {
        this.queue.push({ promiseGenerator, resolve, reject });
        this.processQueue();
      }
    );
  }

  processQueue() {
    while (this.activeCount < this.limit && this.queue.length > 0) {
      const { promiseGenerator, resolve, reject } = this.queue.shift();
      this.activeCount++;
      promiseGenerator()
        .then((result: T) => {
          this.activeCount--;
          resolve(result);
          if (this.queue.length === 0 && this.activeCount === 0) {
            this.allResolved();
          }
          this.processQueue();
        })
        .catch((error: Error) => {
          this.activeCount--;
          reject(error);
          if (this.queue.length === 0 && this.activeCount === 0) {
            this.allResolved();
          }
          this.processQueue();
        });
    }
  }

  allResolved() {
    console.log("All promises have been resolved");
  }
}

const main = async () => {
  const browser = await puppeteer.launch({ headless: true, timeout: 300000 });
  const promiseGenerators: (() => Promise<
    { quote: string; author: string }[]
  >)[] = [];

  const queue = new PromiseQueue<{ quote: string; author: string }[]>(5);
  for (let i = 0; i < 100; i++) {
    promiseGenerators.push(() => {
      return new Promise<{ quote: string; author: string }[]>(
        async (resolve) => {
          const page = await browser.newPage();

          await page.goto(`https://www.goodreads.com/quotes?page=${i + 1}`, {
            timeout: 300000,
            waitUntil: "networkidle2",
          });

          const quotesElements = await page.$$("div.quoteText");
          // const quotes = await Promise.all(
          //   quotesElements.map(async (quoteElement) => {
          //     const quoteText = await quoteElement.evaluate(
          //       (element) => element.textContent
          //     );
          //     return quoteText;
          //   })
          // );
          const quotes = [];
          for (const element of quotesElements) {
            const quoteText = await element.evaluate(
              (element) => element.innerText
            );

            quotes.push(quoteText);
          }
          const qoutesObject = quotes.map((quote) => {
            const [q, a] = quote.split(`\n― `);

            return {
              quote: q.trim(),
              author: a,
            };
          });
          await page.close();
          resolve(qoutesObject);
        }
      );
    });
  }
  Promise.all(
    promiseGenerators.map((promiseGenerator) => queue.add(promiseGenerator))
  )
    .then(async (res) => {
      const quotes = res.flat();
      await fs.writeFile("quotes.json", JSON.stringify(quotes));
      await browser.close();
    })
    .catch(() => {
      console.error("One or more promises have been rejected");
    });
};

main();
