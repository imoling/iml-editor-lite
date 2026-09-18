/**
 * 「语义索引」用的嵌入模型：和本机对话模型一样由编辑器下载、校验、托管运行（llama-server --embedding）。
 * 大小与 SHA256 来自 Hugging Face 仓库元数据（2026-09-18 核对）；三个模型都在 llama.cpp b10936 上实测过。
 */
export interface EmbedModelSpec {
  id: string;
  name: string;
  vendor: string;
  quant: string;
  repo: string;
  file: string;
  size: number;
  sha256: string;
  dims: number;
  /** 单条输入的 token 上限（超了 llama-server 会直接报错） */
  maxTokens: number;
  /** 分块的字符上限：中文约 1 字 1 token，留出标题前缀与特殊 token 的余量 */
  chunkChars: number;
  /** 查询句要加的指令前缀（文档侧不加） */
  queryPrefix: string;
  minRamGB: number;
  recommended?: boolean;
  description: string;
}

export const EMBED_CATALOG: EmbedModelSpec[] = [
  {
    id: 'bge-small-zh-q8',
    name: 'BGE-small-zh v1.5',
    vendor: '智源 BAAI',
    quant: 'Q8_0',
    repo: 'CompendiumLabs/bge-small-zh-v1.5-gguf',
    file: 'bge-small-zh-v1.5-q8_0.gguf',
    size: 26472640,
    sha256: '5a88d266870fbd27c6f329df60de80e2d4cf3bbd5e6f080bd5c1b2e5abb12039',
    dims: 512,
    maxTokens: 512,
    chunkChars: 360,
    queryPrefix: '为这个句子生成表示以用于检索相关文章：',
    minRamGB: 4,
    recommended: true,
    description: '最轻量，几乎不占内存，中文笔记够用；任何机器都能跑',
  },
  {
    id: 'bge-base-zh-q8',
    name: 'BGE-base-zh v1.5',
    vendor: '智源 BAAI',
    quant: 'Q8_0',
    repo: 'CompendiumLabs/bge-base-zh-v1.5-gguf',
    file: 'bge-base-zh-v1.5-q8_0.gguf',
    size: 110001568,
    sha256: '893a0f07100c135b35196fc95058f5933c3435905b167ac29c58d77d7cef4be7',
    dims: 768,
    maxTokens: 512,
    chunkChars: 360,
    queryPrefix: '为这个句子生成表示以用于检索相关文章：',
    minRamGB: 8,
    description: '中文检索质量更好一档，内存占用约 350 MB',
  },
  {
    id: 'qwen3-embedding-0.6b-q8',
    name: 'Qwen3-Embedding 0.6B',
    vendor: '阿里通义',
    quant: 'Q8_0',
    repo: 'Qwen/Qwen3-Embedding-0.6B-GGUF',
    file: 'Qwen3-Embedding-0.6B-Q8_0.gguf',
    size: 639150592,
    sha256: '06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439',
    dims: 1024,
    // 模型本身支持 32k，但每个并发槽都要预留这么多上下文；笔记分块用不着，限到 1024 省内存
    maxTokens: 1024,
    chunkChars: 700,
    queryPrefix: 'Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:',
    minRamGB: 8,
    description: '中英混合与长段落效果最好；建库更慢，内存占用约 1.2 GB',
  },
];

export const DEFAULT_EMBED_MODEL = EMBED_CATALOG[0].id;

export function findEmbedSpec(id: string): EmbedModelSpec | undefined {
  return EMBED_CATALOG.find((m) => m.id === id);
}
