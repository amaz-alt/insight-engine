# Insight Engine

Lovable Brief

Build a Facebook Growth & Insight OS that automates the exact workflow of finding demand inside Facebook Groups, extracting recurring pain points, creating content around those pain points, and publishing back into selected groups in a human-like manner. This is a personal productivity tool for a single Facebook account, not a large-scale automation platform. The primary goal is to reduce daily work to around five minutes while continuously maintaining activity, discovering opportunities, and generating occasional sales. Keep the entire product focused on simplicity and execution rather than enterprise features.

The application should use Lovable Cloud and its managed backend (Supabase/database/functions/storage) wherever possible. Do not require manual Supabase setup, self-hosted databases, authentication configuration, or repetitive environment variable management. The product should work out of the box using Lovable's managed infrastructure. The only external infrastructure is a single VPS provided by the user, which acts as the browser automation worker. The VPS communicates with the Lovable backend through simple authenticated HTTP endpoints. All AI logic, scheduling, dashboards, history, logs, and product intelligence remain inside Lovable Cloud.

The VPS is responsible only for browser automation. It launches a real Chrome instance, keeps a persistent logged-in Facebook session, behaves like a normal human browser, executes scheduled actions, scrapes groups, publishes approved posts, collects results, and sends structured data back to Lovable. The browser should reuse a persistent profile so the Facebook login happens only once unless Facebook invalidates the session. Human-like behavior should include randomized delays, scrolling, natural pauses, varied navigation order, and configurable limits. The tool is intentionally designed for low-volume personal usage rather than aggressive automation.

The system should allow connecting one Facebook account. After the initial login, the session is reused automatically. The user can add Facebook Groups to monitor, organize them into folders or categories, enable or disable groups individually, and assign posting permissions per group. The application should maintain a clean library of monitored groups with metadata such as activity level, last scan, posting permissions, engagement, and health.

The scraper should periodically collect new posts, comments, reactions, timestamps, engagement metrics, and author information from monitored groups. Duplicate content should never be stored. Historical discussions should remain searchable forever. Every collected post should be processed by AI to identify pain points, desired outcomes, objections, frustrations, buying intent, urgency, audience type, niche, sentiment, and recurring topics. Similar discussions should automatically cluster together into demand groups so the dashboard clearly shows which problems are repeatedly appearing across Facebook.

The insights dashboard should continuously rank opportunities by demand. It should display recurring questions, frequency over time, growth trends, engagement levels, buying intent, and confidence scores. The AI should explain why a topic represents an opportunity and automatically recommend suitable digital products, templates, planners, workbooks, prompt packs, checklists, swipe files, journals, or other resources that solve the identified problem.

The content generation system should convert insights directly into marketing assets. From any opportunity, the AI should generate Facebook posts, value posts, story posts, educational posts, engagement posts, promotional posts, comments, follow-up replies, lead magnets, and product descriptions. Multiple variations should be created automatically so no two published posts are identical.

The publishing module should allow selecting one or more Facebook Groups and scheduling content across them. The scheduler should rotate posting order, randomize posting times within a chosen window, vary content versions, maintain delays between actions, avoid duplicate posting, skip groups where posting is unavailable, and record detailed logs of every successful or failed action. The system should always prioritize natural behavior over speed.

A searchable knowledge base should preserve every scraped discussion, AI insight, generated content piece, posting history, and opportunity discovered. Users should be able to search by keyword, niche, pain point, group, date range, buying intent, or trend. Historical insights should continue improving future AI recommendations.

The product should include a lightweight activity dashboard showing today's scans, newly discovered opportunities, scheduled posts, published posts, engagement summaries, AI-generated recommendations, and any actions requiring manual approval. The intended workflow is that the user opens the dashboard for approximately five minutes each day, reviews suggested content, approves or edits if necessary, schedules posts, and lets the system handle the remainder automatically.

Keep the entire application opinionated and simple. Avoid enterprise complexity, team collaboration, billing systems, role management, advanced authentication, marketplace functionality, or unnecessary settings. Build only the features required to automate Facebook research, insight extraction, content creation, scheduling, publishing, and historical learning. The experience should feel like a focused "Facebook Growth Operating System" that quietly runs in the background using Lovable Cloud for intelligence and a single VPS for browser automation, requiring almost no ongoing maintenance from the user.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/57b17798-8af1-491c-b6db-08c05e52f593).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
