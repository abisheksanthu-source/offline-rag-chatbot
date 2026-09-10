import os
import re
import warnings

# Use PyMuPDF cleanly
try:
    import pymupdf as fitz
except ImportError:
    import fitz

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


KNOWLEDGE_FOLDER = "knowledge"


def extract_pdf_text(pdf_path):
    """Extract text from a PDF."""
    text = ""
    try:
        pdf = fitz.open(pdf_path)
        for page in pdf:
            text += page.get_text() + "\n"
        pdf.close()
    except Exception as e:
        print(f"PDF extraction error: {e}")
        return ""
    return text


def save_pdf_as_text(pdf_path):
    """Convert uploaded PDF into a TXT knowledge document."""
    os.makedirs(KNOWLEDGE_FOLDER, exist_ok=True)
    text = extract_pdf_text(pdf_path)

    if not text.strip():
        return False

    txt_path = os.path.join(KNOWLEDGE_FOLDER, "uploaded_pdf.txt")
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(text)

    return True


def load_documents():
    documents = []
    os.makedirs(KNOWLEDGE_FOLDER, exist_ok=True)

    if not os.path.exists(KNOWLEDGE_FOLDER):
        return documents

    for file in sorted(os.listdir(KNOWLEDGE_FOLDER)):
        if file.endswith(".txt"):
            path = os.path.join(KNOWLEDGE_FOLDER, file)
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()
            if text.strip():
                documents.append(text)

    return documents


def clean_text(text):
    """
    Fix broken line breaks from PDF extraction, where a question number
    gets separated from its text, e.g. '1.\n\nDefine Data...'.
    """
    text = re.sub(r'\n\s*(\d{1,2})\.\s*\n+', r'\n\1. ', text)
    text = re.sub(r'\n{2,}', '\n', text)
    return text


def split_into_questions(text):
    """
    Split study-guide style text into individual chunks using top-level
    numbered QUESTION markers as boundaries.
    """
    text = clean_text(text)

    question_verbs = (
        r"Define|What|Write|Name|Analyse|Analyze|Explain|Using|Create|"
        r"Evaluate|Differentiate|List|Discuss|Describe|Compare|Illustrate|"
        r"Mention|Draw|Perform|Design|Develop|Implement|State|Outline|"
        r"Summarize|Identify|Give|Explore|Show|Calculate|How|Why"
    )

    pattern = r'\n(?=\d{1,2}\.\s*(?:' + question_verbs + r')\b)'
    parts = re.split(pattern, text, flags=re.IGNORECASE)
    chunks = [p.strip() for p in parts if p.strip()]

    # If no numbered questions were detected, fallback to paragraph chunking
    if len(chunks) <= 1:
        raw_paras = text.split("\n\n")
        chunks = [p.strip() for p in raw_paras if len(p.strip()) > 30]

    return chunks if chunks else [text.strip()]


def split_text(text, chunk_size=150):
    """Fallback word-based splitter for very long blocks."""
    chunks = []
    words = text.split()

    for i in range(0, len(words), chunk_size):
        chunk = " ".join(words[i:i + chunk_size])
        if chunk.strip():
            chunks.append(chunk)

    return chunks


def build_chunks(documents):
    """Turn documents into a list of focused, question-level chunks."""
    chunks = []
    for document in documents:
        question_blocks = split_into_questions(document)
        for block in question_blocks:
            if len(block.split()) > 350:
                chunks.extend(split_text(block, chunk_size=150))
            else:
                chunks.append(block)

    return chunks


def retrieve_context(question):
    documents = load_documents()

    if not documents:
        return "No PDF has been uploaded yet. Please upload a document to get started."

    chunks = build_chunks(documents)

    if not chunks:
        return "The uploaded PDF does not contain readable text."

    cleaned_q = question.strip()
    if not cleaned_q:
        return "Please ask a question."

    # 1. Word-level TF-IDF (1-gram and 2-grams) with sublinear term frequency
    word_vectorizer = TfidfVectorizer(
        ngram_range=(1, 2),
        stop_words="english",
        sublinear_tf=True
    )

    # 2. Character n-gram TF-IDF (captures typos, misspelled words, variations)
    char_vectorizer = TfidfVectorizer(
        analyzer="char_wb",
        ngram_range=(3, 5),
        sublinear_tf=True
    )

    try:
        all_texts = chunks + [cleaned_q]
        word_vecs = word_vectorizer.fit_transform(all_texts)
        word_sims = cosine_similarity(word_vecs[-1], word_vecs[:-1])[0]
    except Exception:
        word_sims = None

    try:
        char_vecs = char_vectorizer.fit_transform(all_texts)
        char_sims = cosine_similarity(char_vecs[-1], char_vecs[:-1])[0]
    except Exception:
        char_sims = None

    # Combine similarities with hybrid weighting
    if word_sims is not None and char_sims is not None:
        similarities = 0.55 * word_sims + 0.45 * char_sims
    elif word_sims is not None:
        similarities = word_sims
    elif char_sims is not None:
        similarities = char_sims
    else:
        return "Could not process text similarity."

    best_index = int(similarities.argmax())
    best_score = float(similarities[best_index])

    # Rejection threshold: 0.065 accommodates fuzzy matches and typo variations
    if best_score < 0.065:
        return "I could not find an answer to that question in the uploaded PDF. Try rephrasing or asking about another topic in the document."

    return chunks[best_index].strip()