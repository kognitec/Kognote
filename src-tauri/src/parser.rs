use serde::{Serialize, Deserialize};
use std::collections::HashSet;
use std::sync::OnceLock;
use regex::Regex;
use pulldown_cmark::{Parser, Event, Tag, TagEnd};
use rand::Rng;

static BLOCK_COMMENT_RE: OnceLock<Regex> = OnceLock::new();
static FULL_COMMENT_RE: OnceLock<Regex> = OnceLock::new();
static FRONTMATTER_ID_RE: OnceLock<Regex> = OnceLock::new();
static CHECKBOX_RE: OnceLock<Regex> = OnceLock::new();
static DATE_RE: OnceLock<Regex> = OnceLock::new();
static TAG_RE: OnceLock<Regex> = OnceLock::new();
static WIKILINK_RE: OnceLock<Regex> = OnceLock::new();
static URL_RE: OnceLock<Regex> = OnceLock::new();

fn get_block_comment_re() -> &'static Regex {
    BLOCK_COMMENT_RE.get_or_init(|| Regex::new(r"\s*<!--\s*id:\s*[a-f0-9]{8}.*?-->").unwrap())
}
fn get_frontmatter_id_re() -> &'static Regex {
    FRONTMATTER_ID_RE.get_or_init(|| Regex::new(r"<!--\s*id:\s*([a-f0-9]{8}).*?-->").unwrap())
}
fn get_full_comment_re() -> &'static Regex {
    FULL_COMMENT_RE.get_or_init(|| Regex::new(r"<!--\s*id:\s*([a-f0-9]{8})\s*(?:type:\s*(\w+))?\s*(?:status:\s*([\w\s-]+))?\s*(?:due:\s*([\d-]+))?\s*-->").unwrap())
}
fn get_checkbox_re() -> &'static Regex {
    CHECKBOX_RE.get_or_init(|| Regex::new(r"^\s*[-*]\s*\[([ xX])\]\s+(.+)$").unwrap())
}
fn get_date_re() -> &'static Regex {
    DATE_RE.get_or_init(|| Regex::new(r"(?:@due:?|@|due:\s*)?\b(20\d{2})[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b").unwrap())
}
fn get_tag_re() -> &'static Regex {
    TAG_RE.get_or_init(|| Regex::new(r"(?:^|\s|\\)#([a-zA-Z0-9_\-\/]+)").unwrap())
}
fn get_wikilink_re() -> &'static Regex {
    WIKILINK_RE.get_or_init(|| Regex::new(r"(?:\\?\[){2}(.*?)(?:\\?\]){2}").unwrap())
}
fn get_url_re() -> &'static Regex {
    URL_RE.get_or_init(|| Regex::new(r"https?://[^\s)\x22\x27<]+").unwrap())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ParsedTask {
    pub id: String,
    pub content: String,
    pub completed: bool,
    #[serde(rename = "lineNumber")]
    pub line_number: usize,
    #[serde(rename = "dueDate")]
    pub due_date: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ParsedDateRef {
    pub date: String,
    pub context: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ParsedMetadata {
    pub tags: Vec<String>,
    pub links: Vec<String>,
    pub urls: Vec<String>,
    pub tasks: Vec<ParsedTask>,
    #[serde(rename = "dateRefs")]
    pub date_refs: Vec<ParsedDateRef>,
    #[serde(rename = "boardStatus")]
    pub board_status: Option<String>,
    #[serde(rename = "boardPriority")]
    pub board_priority: Option<String>,
    pub snippet: String,
    #[serde(rename = "wordCount")]
    pub word_count: usize,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Block {
    #[serde(rename = "blockId")]
    pub block_id: String,
    #[serde(rename = "parentNoteId")]
    pub parent_note_id: String,
    #[serde(rename = "blockType")]
    pub block_type: String,
    pub content: String,
    pub status: Option<String>,
    #[serde(rename = "dueDate")]
    pub due_date: Option<String>,
    #[serde(rename = "rawMarkdown")]
    pub raw_markdown: String,
    #[serde(rename = "positionIndex")]
    pub position_index: i32,
}

fn generate_block_id() -> String {
    let mut rng = rand::thread_rng();
    let num: u32 = rng.gen();
    format!("{:08x}", num)
}

fn is_hex_color(s: &str) -> bool {
    let len = s.len();
    if len == 3 || len == 6 || len == 8 {
        s.chars().all(|c| c.is_ascii_hexdigit())
    } else {
        false
    }
}

fn is_valid_tag(s: &str) -> bool {
    let clean = s.trim().to_lowercase();
    if clean.len() < 2 {
        return false;
    }
    if clean.starts_with(|c: char| c.is_ascii_digit()) {
        return false;
    }
    if !clean.chars().any(|c| c.is_ascii_alphabetic()) {
        return false;
    }
    if is_hex_color(&clean) {
        return false;
    }
    if matches!(clean.as_str(), "http" | "https" | "true" | "false" | "null" | "undefined" | "none" | "flashcard" | "due") {
        return false;
    }
    true
}

fn parse_frontmatter(content: &str) -> (Option<String>, Option<String>, Vec<String>, String) {
    let mut status = None;
    let mut priority = None;
    let mut tags = Vec::new();
    let mut rest = content.to_string();

    if content.starts_with("---") {
        let lines: Vec<&str> = content.lines().collect();
        if lines.len() > 1 {
            let mut end_idx = None;
            for i in 1..lines.len() {
                if lines[i].trim() == "---" {
                    end_idx = Some(i);
                    break;
                }
            }
            if let Some(idx) = end_idx {
                let frontmatter_lines = &lines[1..idx];
                let frontmatter_text = frontmatter_lines.join("\n");
                
                let rest_lines = &lines[idx+1..];
                rest = rest_lines.join("\n");

                if let Ok(value) = serde_yaml::from_str::<serde_yaml::Value>(&frontmatter_text) {
                    if let Some(s) = value.get("status").and_then(|v| v.as_str()) {
                        let s_lower = s.to_string().to_lowercase();
                        if s_lower != "none" && !s_lower.is_empty() {
                            status = Some(s_lower);
                        }
                    }
                    if let Some(p) = value.get("priority").and_then(|v| v.as_str()) {
                        priority = Some(p.to_string());
                    }
                    if let Some(t_val) = value.get("tags") {
                        if let Some(arr) = t_val.as_sequence() {
                            for v in arr {
                                if let Some(tag_str) = v.as_str() {
                                    tags.push(tag_str.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    (status, priority, tags, rest)
}

pub fn update_block_markdown(block: &mut Block) {
    block.raw_markdown = get_block_comment_re().replace_all(&block.raw_markdown, "").to_string();
}

pub fn parse_markdown_to_blocks(file_path: &str, raw_content: &str) -> Vec<Block> {
    let normalized_content = raw_content.replace("\r\n", "\n");
    let content = normalized_content.as_str();
    let (board_status, _board_priority, _frontmatter_tags, body_text) = parse_frontmatter(content);

    // 1. If we have frontmatter, we add it as a block at position_index = 0
    let mut blocks = Vec::new();
    let mut position_index = 0;

    if content.starts_with("---") {
        if let Some(end_idx) = content[3..].find("---") {
            let actual_end = end_idx + 3;
            let frontmatter_block = &content[0..actual_end + 3];
            
            let block_id = if let Some(caps) = get_frontmatter_id_re().captures(frontmatter_block) {
                caps[1].to_string()
            } else {
                generate_block_id()
            };

            let clean_frontmatter = get_frontmatter_id_re().replace_all(frontmatter_block, "").trim().to_string();

            blocks.push(Block {
                block_id,
                parent_note_id: file_path.to_string(),
                block_type: "frontmatter".to_string(),
                content: clean_frontmatter.clone(),
                status: board_status.clone(),
                due_date: None,
                raw_markdown: clean_frontmatter,
                position_index,
            });
            position_index += 1;
        }
    }

    // 2. Split body text into block ranges using pulldown-cmark
    let parser = Parser::new(&body_text).into_offset_iter();
    let mut ranges = Vec::new();
    let mut current_start = None;
    let mut depth = 0;

    for (event, range) in parser {
        match event {
            Event::Start(tag) => {
                let is_item = matches!(tag, Tag::Item);
                if depth == 0 || (depth == 1 && is_item) {
                    current_start = Some(range.start);
                }
                depth += 1;
            }
            Event::End(tag) => {
                depth -= 1;
                let is_item = matches!(tag, TagEnd::Item);
                if depth == 0 || (depth == 1 && is_item) {
                    if let Some(start) = current_start {
                        ranges.push(start..range.end);
                        current_start = None;
                    }
                }
            }
            _ => {
                if depth == 0 {
                    ranges.push(range);
                }
            }
        }
    }

    // Process each block range
    let checkbox_re = get_checkbox_re();
    let date_re = get_date_re();
    let comment_re = get_full_comment_re();

    for range in ranges {
        let block_raw = &body_text[range];
        if block_raw.trim().is_empty() {
            continue;
        }

        // Parse or generate ID
        let mut block_id = generate_block_id();
        let mut status = None;
        let mut due_date = None;

        if let Some(caps) = comment_re.captures(block_raw) {
            block_id = caps[1].to_string();
            if let Some(s) = caps.get(3) {
                status = Some(s.as_str().to_string());
            }
            if let Some(d) = caps.get(4) {
                due_date = Some(d.as_str().to_string());
            }
        }

        let clean_block = comment_re.replace_all(block_raw, "").trim().to_string();
        
        // Determine block type and default properties
        let mut block_type = "paragraph".to_string();
        if clean_block.starts_with('#') {
            block_type = "heading".to_string();
        } else if checkbox_re.is_match(&clean_block) {
            block_type = "task".to_string();
            if status.is_none() {
                if let Some(caps) = checkbox_re.captures(&clean_block) {
                    let completed = &caps[1] == "x" || &caps[1] == "X";
                    status = Some(if completed { "Done".to_string() } else { "Todo".to_string() });
                }
            }
            if due_date.is_none() {
                if let Some(date_caps) = date_re.captures(&clean_block) {
                    due_date = Some(date_caps[1].replace('/', "-"));
                }
            }
        } else if clean_block.starts_with("```") {
            block_type = "code".to_string();
        } else if clean_block.starts_with("-") || clean_block.starts_with("*") {
            block_type = "list-item".to_string();
        }

        let raw_markdown = clean_block.clone();

        blocks.push(Block {
            block_id,
            parent_note_id: file_path.to_string(),
            block_type,
            content: clean_block,
            status,
            due_date,
            raw_markdown,
            position_index,
        });
        position_index += 1;
    }

    blocks
}

pub fn parse_markdown(content: &str) -> ParsedMetadata {
    // Helper function that parses the markdown using the blocks and aggregates metadata
    let blocks = parse_markdown_to_blocks("temp_path", content);

    let mut tags_set = HashSet::new();
    let mut links_set = HashSet::new();
    let mut urls_set = HashSet::new();
    let mut tasks = Vec::new();
    let mut date_refs = Vec::new();
    let mut board_status = None;
    let mut board_priority = None;
    let mut word_count = 0;
    let mut clean_snippet_lines = Vec::new();

    let tag_re = get_tag_re();
    let wikilink_re = get_wikilink_re();
    let url_re = get_url_re();
    let date_re = get_date_re();
    let checkbox_re = get_checkbox_re();

    for block in &blocks {
        if block.block_type == "frontmatter" {
            // Extract frontmatter info
            if let Ok(value) = serde_yaml::from_str::<serde_yaml::Value>(&block.content) {
                if let Some(s) = value.get("status").and_then(|v| v.as_str()) {
                    let s_lower = s.to_string().to_lowercase();
                    if s_lower != "none" && !s_lower.is_empty() {
                        board_status = Some(s_lower);
                    }
                }
                if let Some(p) = value.get("priority").and_then(|v| v.as_str()) {
                    board_priority = Some(p.to_string());
                }
                if let Some(t_val) = value.get("tags") {
                    if let Some(arr) = t_val.as_sequence() {
                        for v in arr {
                            if let Some(tag_str) = v.as_str() {
                                tags_set.insert(tag_str.to_lowercase());
                            }
                        }
                    }
                }
            }
            continue;
        }

        word_count += block.content.split_whitespace().count();

        // Extract inline tags (skip code blocks)
        if block.block_type != "code" {
            for cap in tag_re.captures_iter(&block.content) {
                let t = cap[1].to_lowercase();
                if is_valid_tag(&t) {
                    tags_set.insert(t);
                }
            }
        }

        // Extract date references & snippet lines
        if block.block_type != "task" {
            for cap in date_re.captures_iter(&block.content) {
                let date = cap[1].replace('/', "-");
                let context = block.content.replace('[', "").replace(']', "").trim().to_string();
                date_refs.push(ParsedDateRef {
                    date,
                    context: if context.len() > 120 { format!("{}...", &context[..120]) } else { context },
                });
            }

            if block.block_type == "paragraph" {
                clean_snippet_lines.push(block.content.as_str());
            }
        }

        // Extract wikilinks
        for cap in wikilink_re.captures_iter(&block.content) {
            let link_name = cap[1].replace('\\', "").trim().to_string();
            if !link_name.is_empty() && link_name.to_lowercase() != "none" {
                links_set.insert(link_name);
            }
        }

        // Extract URLs
        for cap in url_re.captures_iter(&block.content) {
            let url = cap[0].trim().to_string();
            if !url.is_empty() {
                urls_set.insert(url);
            }
        }
    }

    // Extract tasks line-by-line for 100% accurate file line numbers
    for (line_idx, line) in content.lines().enumerate() {
        if let Some(caps) = checkbox_re.captures(line) {
            let completed = &caps[1] == "x" || &caps[1] == "X";
            let raw_content = &caps[2];

            let mut task_tags = Vec::new();
            for cap in tag_re.captures_iter(raw_content) {
                let t = cap[1].to_lowercase();
                if is_valid_tag(&t) {
                    task_tags.push(t);
                }
            }

            let mut due_date = None;
            if let Some(date_caps) = date_re.captures(raw_content) {
                due_date = Some(date_caps[1].replace('/', "-"));
            }

            let clean_content = tag_re.replace_all(raw_content, "")
                .replace("due:", "")
                .trim()
                .to_string();

            tasks.push(ParsedTask {
                id: format!("line:{}", line_idx),
                content: if clean_content.is_empty() { raw_content.trim().to_string() } else { clean_content },
                completed,
                line_number: line_idx,
                due_date,
                tags: task_tags,
            });
        }
    }

    let raw_snippet = clean_snippet_lines.join(" ");
    let snippet = if raw_snippet.len() > 100 {
        format!("{}...", &raw_snippet[..100])
    } else {
        raw_snippet
    };

    ParsedMetadata {
        tags: tags_set.into_iter().collect(),
        links: links_set.into_iter().collect(),
        urls: urls_set.into_iter().collect(),
        tasks,
        date_refs,
        board_status,
        board_priority,
        snippet,
        word_count,
    }
}
