from crawlee.playwright_crawler import PlaywrightCrawler, PlaywrightCrawlingContext
from fastapi import Depends
from playwright.async_api import async_playwright
from src.config import web_search_summary_limit


class SpiderService:
    def __init__(self, playwright_crawler: PlaywrightCrawler):
        self.crawler = playwright_crawler

    def _output(
        self,
        url: str = "",
        title: str = "",
        summary: str = "",
        content: list[str] = None,
    ):
        return {
            "url": url.strip(),
            "title": title.strip(),
            "summary": summary.strip()[:web_search_summary_limit],
            "content": content,
        }

    def _bing_url(self, query: str):
        return f"https://www.bing.com/search?q={query}"

    def _baidu_baike_url(self, keyword: str):
        return f"https://baike.baidu.com/item/{keyword}"

    async def _bing_crawl(self, query: str):
        results = []

        @self.crawler.router.default_handler
        async def handle(context: PlaywrightCrawlingContext):
            items = await context.page.query_selector_all("li.b_algo")
            count = 0
            for item in items:
                if count > 4:
                    break
                title_el = await item.query_selector("h2")
                link_el = await title_el.query_selector("a") if title_el else None
                if title_el and link_el:
                    title = await title_el.inner_text()
                    href = await link_el.get_attribute("href")
                    results.append(self._output(url=href, title=title))
                count += 1

        await self.crawler.run([self._bing_url(query)])
        return results

    async def _bing_get_content(self, url: str):
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            try:
                await page.goto(url, timeout=8000)
                await page.wait_for_load_state("networkidle")
                real_url = page.url
                title = await page.title()

                text = await page.evaluate(
                    """() => {
                        const elements = Array.from(document.querySelectorAll('div, article, section'));
                        let maxText = '';
                        for (const el of elements) {
                            const text = el.innerText || '';
                            if (text.length > maxText.length) {
                                maxText = text;
                            }
                        }
                        return maxText;
                    }"""
                )

            except Exception as e:
                real_url = url
                title = ""
                text = f"[Error] {real_url} {str(e)}"
            finally:
                await browser.close()

            return self._output(url=real_url, title=title, summary=text)

    async def _baike_crawl(self, keyword: str, full_text: bool = False):
        url = self._baidu_baike_url(keyword)
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            try:
                await page.goto(url, timeout=8000)
                await page.wait_for_load_state("domcontentloaded")

                title = await page.title()
                containers = await page.locator(
                    "//*[@id='J-lemma-main-wrapper']/div[2]/div/div[1]/div/div"
                ).all()
                content = []
                summary = []
                index = 0
                for item in containers:
                    text = await item.text_content()
                    if index > 4 or len(text) > web_search_summary_limit:
                        content.append(text)
                    else:
                        summary.append(text)
                    index += 1
            except Exception as e:
                return {"url": url, "title": "", "summary": f"[Error] {str(e)}"}
            finally:
                await browser.close()

            return self._output(
                url=url,
                title=title,
                summary="".join(summary),
                content=content if full_text else None,
            )

    async def search(self, keyword: str):
        try:
            res_list = await self._bing_crawl(keyword)
            baike_content = await self._baike_crawl(keyword)
            urls = [item["url"] for item in res_list]
            res = []
            res.append(baike_content)
            for url in urls:
                content = await self._bing_get_content(url)
                if not content:
                    continue
                summary = content.get("summary", "").strip()
                title = content.get("title", "").strip()
                if (
                    (not title and not summary)
                    or (summary.startswith("[Error]") or "Timeout" in summary)
                    or (len(summary) < 20)
                ):
                    continue
                res.append(content)
        except Exception as e:
            print(e)
        return res


def get_playwright_crawler():
    return PlaywrightCrawler(max_requests_per_crawl=10)


def get_spider_service(
    playwright_crawler: PlaywrightCrawler = Depends(get_playwright_crawler),
):
    return SpiderService(playwright_crawler)
