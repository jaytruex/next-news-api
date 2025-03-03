import { load } from "cheerio";
import { newsSources } from "./constants";
import { findElement } from "@/lib/utils/cheerio";
import { articleFromItem } from "@/lib/news/utils";
import { BadRequest } from "@/exceptions/server";

/**
 * Robustly cleans and normalizes HTML content to plain text.
 * @param {string} html - The raw HTML string to clean.
 * @returns {string} - The cleaned and normalized plain text.
 */
const cleanText = (html: string): string => {
  if (!html || typeof html !== "string") return "";

  try {
    const $ = load(html);

    // Remove non-content elements
    $("script, style, noscript, iframe, svg").remove();

    // Extract text
    let text = $.text();

    // Decode HTML entities (e.g., &amp; → &)
    text = he.decode(text);

    // Normalize whitespace (remove extra spaces, line breaks, tabs)
    text = text.replace(/\s+/g, " ").trim();

    return text;
  } catch (error) {
    console.error("Error in cleanText:", error);
    return html; // Fallback to returning raw HTML if parsing fails
  }
};

// Crawler function to fetch full content from article URL
const crawlArticleContent = async (url: string): Promise<string> => {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/113.0",
      },
    });

    if (response.status !== 200) {
      console.warn(`Failed to fetch article at ${url}`);
      return "";
    }

    const html = await response.text();
    const $ = load(html);

    // Heuristic to extract main content
    let content = "";

    if ($("article").length) {
      content = $("article").text();
    } else {
      $("p").each((_, el) => {
        content += $(el).text() + "\n";
      });
    }

    return content.trim();
  } catch (error: any) {
    console.error(`Error crawling ${url}: ${error.message}`);
    return "";
  }
};

export const fetchNewsFromRSS = async (source: Source): Promise<Article[]> => {
  let response;
  try {
    response = await fetch(source.url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/113.0",
      },
    });
  } catch (error: any) {
    console.log(`Failed to fetch RSS feed ${source.name}, ${error.message}`);
    return [];
  }

  if (response.status !== 200) {
    console.log(`Bad response from RSS feed ${source.url}`);
    return [];
  }

  const responseText = await response.text();
  const $ = load(responseText, { xmlMode: true });

  const items = findElement($, "item");

  if (!items) {
    console.log(`No items found in ${source.url}`);
    return [];
  }

  const articles: Article[] = [];

  for (let i = 0; i < items.length; i++) {
    const element = items.eq(i);
    const itemElement = $(element);

    const baseArticle = articleFromItem(itemElement);
    if (!baseArticle) continue;

    // Extract <content:encoded> and <description>
    const contentEncoded = itemElement.find("content\\:encoded").text();
    const description = itemElement.find("description").text();
    let fullContent = cleanText(contentEncoded);

    // Fallback to crawling if <content:encoded> is missing
    if (!fullContent) {
      fullContent = await crawlArticleContent(baseArticle.url);
    }

    // Final fallback to <description> if crawling also fails
    if (!fullContent) {
      fullContent = cleanText(description);
    }

    const article: Article = {
      source: source.name,
      ...baseArticle,
      fullText: fullContent,
    };

    articles.push(article);
    if (articles.length >= 20) break;
  }

  if (articles.length === 0) {
    console.log(`No valid articles found from ${source.url}`);
  }

  return articles;
};

export const getAllNews = async (): Promise<Article[]> => {
  const allArticles: Article[] = [];

  const fetchPromises = newsSources.map(async (source) => {
    try {
      const articles = await fetchNewsFromRSS(source);
      return articles;
    } catch (error: any) {
      console.error(`Failed to fetch from ${source.name}: ${error.message}`);
      return [];
    }
  });

  const results = await Promise.allSettled(fetchPromises);

  results.forEach((result) => {
    if (result.status === "fulfilled") {
      allArticles.push(...result.value);
    } else {
      console.error(`Source fetch failed: ${result.reason}`);
    }
  });

  return allArticles;
};
