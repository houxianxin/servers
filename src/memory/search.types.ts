// === 基础与配置类型 ===

/**
 * 代表一个独立的搜索结果项。
 */
export interface SearchResultItem {
  id: string;                 // 唯一标识符 (例如，文档ID, 节点ID)
  content: string;              // 结果的文本内容
  score: number;                // 最终得分 (融合后或重排后)
  originalScores: { retriever: string; score: number }[]; // 来自各个检索器的原始分数
  retrievedBy: string[];        // 记录被哪些检索器命中
}

/**
 * 混合检索系统的顶层配置。
 */
export interface HybridSearchConfig {
  retrievers: IRetriever[];     // 要使用的检索器实例数组
  reranker?: IReranker;         // 可选的重排器
  fusionAlgorithm: 'RRF';       // 指定融合算法 (未来可扩展)
}

// === 模型提供者接口与实现 ===

/**
 * 模型提供者接口，用于解耦模型源。
 */
export interface IModelProvider {
  /**
   * 为单个文本片段生成嵌入向量。
   */
  getEmbedding(text: string): Promise<number[]>;

  /**
   * 为多个文本片段批量生成嵌入向量。
   */
  getEmbeddings(texts: string[]): Promise<number[][]>;

  /**
   * (为未来CrossEncoderReranker准备)
   * 计算查询与文档对的交叉编码器分数。
   */
  getCrossEncoderScore?(query: string, document: string): Promise<number>;
}

/**
 * 本地模型提供者的配置。
 */
export interface LocalModelProviderConfig {
  embeddingModel: string; // 例如 'Xenova/all-MiniLM-L6-v2'
  crossEncoderModel?: string; // 例如 'Xenova/ms-marco-MiniLM-L-6-v2'
}

/**
 * 外部API模型提供者的配置。
 */
export interface ApiModelProviderConfig {
  baseURL: string;        // 例如 'https://api.openai.com/v1'
  apiKey: string;         // API密钥
  embeddingModel: string; // 例如 'text-embedding-3-small'
  crossEncoderModel?: string;
}


// === 检索器接口 ===

/**
 * 检索器通用接口。
 */
export interface IRetriever {
  /**
   * 检索器的唯一名称。
   */
  name: string;

  /**
   * 根据查询执行检索。
   * @param query 用户的搜索查询。
   * @returns 一组带有原始分数的搜索结果。
   */
  retrieve(query: string): Promise<{ id: string; content: string; score: number }[]>;
}


// === 重排器接口与实现 ===

/**
 * 重排器通用接口。
 */
export interface IReranker {
  /**
   * 对融合后的结果列表进行重新排序。
   * @param results 经过融合的、初步排序的结果列表。
   * @param query 原始用户查询。
   * @returns 经过精细重排的最终结果列表。
   */
  rerank(results: SearchResultItem[], query: string): Promise<SearchResultItem[]>;
}
