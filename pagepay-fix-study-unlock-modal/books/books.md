hey!, aisde of gutendex, where can i get opensource books for free, educational opensource books, etc


If you are looking for high-quality, free, open-source books—especially **educational textbooks, academic research, and technical guides**—you want to look into the **OER (Open Educational Resources)** ecosystem.

Unlike Gutendex/Project Gutenberg (which focus heavily on older, public-domain literature), these platforms provide modern, peer-reviewed, and up-to-date learning materials funded by universities and global organizations.

Here are the best platforms to get open-source educational books for free:

---

### 1. OpenStax (By Rice University)

* **Best For:** Core university and college textbooks (Physics, Calculus, Chemistry, Economics, Computer Science, Biology).
* **Why it’s great:** These are massive, high-quality, peer-reviewed textbooks designed exactly like standard ₦150k commercial college books, but they are 100% free. You can read them directly in your browser or download full, high-res PDFs.
* **Website:** `openstax.org`

### 2. Open Textbook Library (By University of Minnesota)

* **Best For:** Higher education textbooks across virtually every discipline (from Advanced Software Engineering to Law and Medicine).
* **Why it’s great:** It acts as a massive search engine and repository for openly licensed textbooks used across major global universities. Best of all, university professors leave detailed public reviews on each book, so you know exactly which ones are the highest quality.
* **Website:** `open.umn.edu/opentextbooks`

### 3. LibreTexts

* **Best For:** Highly technical STEM subjects (Mathematics, Chemistry, Engineering, Medicine, and Social Sciences).
* **Why it’s great:** It is one of the largest open-source text projects in the world. It allows you to "remix" chapters or read through thousands of multi-authored, peer-reviewed courses and text volumes completely online or via PDF.
* **Website:** `libretexts.org`

### 4. OER Commons

* **Best For:** Full curriculums, lesson plans, course modules, and niche educational textbooks from pre-K up to graduate level.
* **Why it’s great:** It is a massive digital public library backed by global educational networks. If you are trying to study a topic comprehensively (like data structures or linear algebra), you can find whole textbooks bundled alongside interactive exercises and video lectures.
* **Website:** `oercommons.org`

### 5. DOAB (Directory of Open Access Books)

* **Best For:** Scholarly research books, academic monographs, and post-graduate level literature.
* **Why it’s great:** If you need deep, research-heavy academic books rather than just standard introductory school textbooks, DOAB indexes thousands of peer-reviewed, open-access books from top tier university presses (like Oxford, Cambridge, and MIT).
* **Website:** `doabooks.org`

---

### 💡 Quick Technical Pro-Tip:

If you are looking for open-source books specifically for **Software Engineering, Programming, and Tech**, check out **IntechOpen** (`intechopen.com`) or the community-curated **Free Programming Books** repository on GitHub (by EbookFoundation). They have thousands of completely free, openly licensed programming textbooks covering everything from advanced JavaScript architecture to Python backend engines.

Are you looking for books on a specific subject right now, or just gathering general resources to build up your digital library?


you know that am building a Read and Earn mobile app that users read 1 minute slice of 3k characters and earn points by watching ads, i share ad revenue with them, but i only got books from gutendex which are just novels and, frictions and Romance, fantasy, etc, but my app is not only for earning, but also for education, so this is why a looking for where to get opensource educational books that comprises from creche to higher institutions, research, for all types of courses, etc. i hope you understand m pain point now.


I completely get your pain point now, Prince. You aren’t just looking for reading material; you are building an **automated backend pipeline** for a "Read & Earn" app.

Novels from Project Gutenberg (via Gutendex) are great for casual reading, but they don't solve your core vision of driving *real educational value*. You need structured, high-quality textbooks, research papers, and nursery/primary materials that you can break down into your strict **3,000-character (roughly 450–500 words) 1-minute reading slices**.

To make this automated, you need platforms that don't just have free books, but also have **APIs**, open databases, or clean bulk download structures so your backend can pull, parse, and slice the text into your database.

Here are the exact sources you should target for your educational pipeline:

---

### 1. For Higher Education, Science, & Technical Courses

If you want massive, clean text data for university courses (Computer Science, Business, Physics, etc.), **OpenStax** is your goldmine.

* **The Content:** Deep, peer-reviewed textbooks from Rice University.
* **The Developer Advantage:** OpenStax provides a completely public, open API (**OpenStax CMS API**). You can query their books, pull the content programmatically as clean JSON/HTML blocks, and let your Node.js backend automatically slice the text into 3,000-character segments for your app.
* **API Reference:** `openstax.org/api/v2/pages/` (You can query by book title).

### 2. For Academic Research & Post-Graduate Studies

If your users want to read cutting-edge research papers in 1-minute chunks, use **CORE** or **DOAB**.

* **CORE (`core.ac.uk`):** This is the world's largest aggregator of open-access research papers. Crucially for you, they have a massive, developer-friendly **Free REST API**. You can pull the full text of millions of academic research papers directly into your backend, strip out the metadata, and serve them as premium "Research Slices" to your users.
* **DOAB (`doabooks.org`):** Offers a public OAI-PMH harvesting endpoint and data dumps. You can download their entire catalog metadata and open-text links to parse.

### 3. For Primary, Creche, and Secondary (K-12) Education

Finding open-source primary school textbooks is usually the hardest part because secondary education is heavily commercialized. However, these two platforms are built explicitly for open text distribution:

* **Saylor Academy (`saylor.org`):** They offer completely open college and K-12 courses. Most of their textbooks are hosted openly on GitHub or via clean PDF links that you can easily pass through a PDF-to-text parser script in Node.js.
* **Global Digital Library (`digitallibrary.io`):** Backed by UNESCO, this platform hosts thousands of early-grade reading resources and children's books in multiple languages. They have a completely open API and allow bulk downloading, which is perfect for your "Creche to Primary" section.

---

### 🛠️ The Tech Strategy: How to Build the Parsing Pipeline

Since you are running a Node.js/Express backend with Prisma, you don't want to copy and paste these books manually. Here is how you can automate the ingestion:

```
[Educational API / Open Source PDF] 
               │
               ▼
[Node.js Ingestion Script] ───► Strips HTML/Images to Raw Text
               │
               ▼
[Slicing Function] ───────────► Cuts text into strict 3,000-char blocks
               │
               ▼
[Prisma Client] ──────────────► Saves to `BookSlice` Table in Postgres

```

To make sure your slices make sense to the reader, use a simple regex loop in your Node.js script instead of cutting exactly at character 3,000 (which might split a word in half).

Have the script look for the nearest period (`.`) or space (` `) around the 3,000-character mark to end the slice cleanly:

```javascript
function sliceText(text, chunkSize = 3000) {
  const chunks = [];
  let startIndex = 0;

  while (startIndex < text.length) {
    let endIndex = startIndex + chunkSize;
    
    // If we are not at the end of the text, find the nearest full stop
    if (endIndex < text.length) {
      const nextPeriod = text.indexOf('.', endIndex);
      if (nextPeriod !== -1 && nextPeriod - endIndex < 200) {
        endIndex = nextPeriod + 1; // End cleanly at the sentence
      }
    } else {
      endIndex = text.length;
    }

    chunks.push(text.substring(startIndex, endIndex).trim());
    startIndex = endIndex;
  }
  return chunks;
}

```

By connecting your backend to the **OpenStax API** or **CORE API**, you can instantly seed your PostgreSQL database with thousands of high-quality, genuine educational reading slices across hundreds of actual academic courses.

Would you like me to help you sketch out the Prisma schema for how these books, chapters, and 1-minute reading slices should link together in your database?


am not using pern stack for this project, am using python/fastAPI, react-native/expo


Got it! My bad for assuming the PERN stack from earlier. **Python (FastAPI)** on the backend paired with **React Native / Expo** on the frontend is a fantastic stack for this. FastAPI is incredibly fast for scraping, processing text, and serving paginated slices, while Expo makes handling native ads smooth.

Let’s adjust the game plan to fit this Python + React Native setup.

---

### 1. Ingesting Educational Books via Python (FastAPI Backend)

Python is the king of data processing. Instead of manually handling texts, you can build an internal admin endpoint in FastAPI that pulls open educational books using their APIs and runs them through your 3,000-character slicing logic.

Here are the specific tools to hit those open-access platforms via Python:

* **OpenStax (University Textbooks):** You can target OpenStax’s public API endpoint (`[https://openstax.org/apps/cms/api/v2/pages/](https://openstax.org/apps/cms/api/v2/pages/)`). Using Python’s `httpx` or `requests` library, you can pull textbook page content directly as clean HTML/JSON.
* **CORE API (Research Papers):** Register for a free API key at `core.ac.uk`. Their `v3` API (`[https://api.core.ac.uk/v3/search/works](https://api.core.ac.uk/v3/search/works)`) allows you to query research fields and specifically request the full text using the `fulltext` flag in your queries.

#### The FastAPI Slicing Logic

Here is how you can write the Python helper function to slice text cleanly at sentence boundaries (so words or sentences don't get cut in half right at 3,000 characters):

```python
import re

def slice_educational_text(text: str, target_chunk_size: int = 3000) -> list[str]:
    """
    Slices a book or research paper into segments of roughly 3,000 characters,
    ensuring it breaks cleanly at the end of a sentence.
    """
    chunks = []
    start_idx = 0
    text_len = len(text)
    
    while start_idx < text_len:
        end_idx = start_idx + target_chunk_size
        
        if end_idx < text_len:
            # Look ahead to find the nearest sentence completion (.)
            # within a reasonable window so we don't cut off mid-sentence
            look_ahead = text.find('.', end_idx)
            if look_ahead != -1 and (look_ahead - end_idx) < 200:
                end_idx = look_ahead + 1  # Include the period
        else:
            end_idx = text_len
            
        chunk = text[start_idx:end_idx].strip()
        if chunk:
            chunks.append(chunk)
            
        start_idx = end_idx
        
    return chunks

```

---

### 2. The Database Schema (SQLAlchemy / SQLModel)

Since you are using FastAPI, you are likely using **SQLAlchemy** or **SQLModel** with PostgreSQL. You want a schema that structure books into modules or categories (e.g., "Primary 1 - Mathematics", "University - Computer Science") and links them to individual slices.

Here is a clean layout for your models:

```python
from sqlalchemy import Column, Integer, String, Text, ForeignKey
from sqlalchemy.orm import relationship, declarative_base

Base = declarative_base()

class Book(Base):
    __tablename__ = "books"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    author = Column(String(255))
    category = Column(String(100))  # e.g., "University / Physics", "Primary / English"
    level = Column(String(50))     # e.g., "Higher Institution", "Creche", "Secondary"
    
    # Relationships
    slices = relationship("BookSlice", back_populates="book", cascade="all, delete")

class BookSlice(Base):
    __tablename__ = "book_slices"
    
    id = Column(Integer, primary_key=True, index=True)
    book_id = Column(Integer, ForeignKey("books.id", ondelete="CASCADE"))
    slice_number = Column(Integer, nullable=False)  # 1, 2, 3... helps track reading progress
    content = Column(Text, nullable=False)          # The ~3000 character string
    
    book = relationship("Book", back_populates="slices")

```

---

### 3. The Mobile Client Experience (React Native / Expo)

On the mobile side, your app will consume these slices one by one. To keep data costs minimal for your Nigerian users, you want to paginate this strictly.

* **State Management:** When a user opens a book, fetch just the *current* slice number they are on based on their user progress profile, rather than downloading the entire book text.
* **The Timer Trigger:** Use a JavaScript countdown timer in React Native to track the 1-minute read constraint. Once the timer hits 0, unlock the "Claim Points" button, which calls the Google Mobile Ads plugin to trigger a Rewarded Video or Interstitial Ad.
* **Securing the Payout:** Never let the React Native mobile app tell the backend "give this user points." Clients can be manipulated. Instead, when the user finishes watching the ad, let the mobile app trigger the ad completion event, but use secure backend webhooks from your ad provider to verify the ad impression before updating the user’s wallet in PostgreSQL.