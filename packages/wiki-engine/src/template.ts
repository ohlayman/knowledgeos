export type PageType = 'concept' | 'technology' | 'project' | 'comparison' | 'research' | 'source';

export const PAGE_TEMPLATES: Record<PageType, string[]> = {
  concept: ['定义', '工作原理', '与其他概念的关系', '常见误解', '来源'],
  technology: ['是什么', '解决什么问题', '核心能力', '限制与代价', '替代方案', '来源'],
  project: ['定位', '架构', '关键设计', '适用场景', '来源'],
  comparison: ['对比维度', '逐项差异', '选型建议', '来源'],
  research: ['问题', '方法', '结论', '局限', '来源'],
  source: ['来源清单'],
};

export const PAGE_TYPE_LABELS: Record<PageType, string> = {
  concept: '概念',
  technology: '技术',
  project: '项目',
  comparison: '对比',
  research: '研究',
  source: '来源',
};
