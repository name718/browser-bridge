/**
 * 中文同义词映射表
 *
 * 用于 scoreElements() 的模糊匹配增强。
 * 从 content.ts 中抽离为独立模块，便于维护和测试。
 *
 * 设计原则：
 * - 同义词 boost 不应覆盖 role、disabled、高风险文本等更强约束
 * - 需配合误命中测试（如"保存"不应优先命中"确认删除"中的"确认"）
 */

export const SYNONYM_MAP: Record<string, string[]> = {
  // 操作动词
  "查询": ["搜索", "检索", "筛选", "查找", "查找", "search", "filter"],
  "保存": ["确认", "确定", "提交", "save", "confirm", "submit"],
  "取消": ["关闭", "放弃", "cancel", "close"],
  "删除": ["移除", "清除", "remove", "delete", "clear"],
  "编辑": ["修改", "变更", "edit", "modify"],
  "新增": ["添加", "新建", "创建", "add", "create", "new"],
  "刷新": ["更新", "reload", "refresh", "update"],
  "导出": ["下载", "export", "download"],
  "导入": ["上传", "import", "upload"],
  "返回": ["后退", "back", "return"],
  "下一步": ["继续", "next", "continue"],
  "上一步": ["previous", "back"],
  "提交": ["递交", "submit", "commit"],
  "重置": ["清空", "reset", "clear"],
  "展开": ["打开", "expand", "open"],
  "收起": ["折叠", "collapse", "fold"],
  "全选": ["select all", "check all"],
  "复制": ["拷贝", "copy"],
  "粘贴": ["paste"],
  "打印": ["print"],
  "分享": ["share"],
  "登录": ["登入", "sign in", "login", "log in"],
  "注册": ["signup", "sign up", "register"],
  "退出": ["登出", "logout", "sign out"],
  "设置": ["配置", "settings", "config"],
  "帮助": ["help"],
  "关于": ["about"],

  // 表单字段
  "用户名": ["账号", "user", "username", "account"],
  "密码": ["口令", "password", "passwd"],
  "邮箱": ["邮件", "email", "mail"],
  "手机": ["电话", "手机号", "phone", "mobile", "tel"],
  "地址": ["住址", "address"],
  "姓名": ["名字", "name"],
  "公司": ["企业", "company", "enterprise"],
  "部门": ["department", "dept"],
  "职位": ["岗位", "position", "title"],
  "备注": ["说明", "remark", "note", "comment"],
  "日期": ["时间", "date", "time"],
  "数量": ["数目", "quantity", "count", "number"],
  "金额": ["价格", "amount", "price"],
  "状态": ["state", "status"],
  "类型": ["种类", "type", "category"],
  "级别": ["等级", "level", "grade"],
  "标题": ["题目", "title", "subject"],
  "内容": ["正文", "content", "body"],
  "描述": ["简介", "description", "desc"],
  "开始": ["起始", "start", "begin"],
  "结束": ["截止", "end", "finish"],
};

/**
 * 获取查询词的同义词列表
 *
 * @param query 原始查询词
 * @returns 同义词数组（不包含原始词本身）
 */
export function getSynonyms(query: string): string[] {
  const normalized = query.toLowerCase().trim();

  // 直接匹配
  if (SYNONYM_MAP[normalized]) {
    return SYNONYM_MAP[normalized];
  }

  // 反向查找：如果 query 是某个条目的同义词，返回该条目的主词和其他同义词
  for (const [key, synonyms] of Object.entries(SYNONYM_MAP)) {
    if (synonyms.some((s) => s.toLowerCase() === normalized)) {
      return [key, ...synonyms.filter((s) => s.toLowerCase() !== normalized)];
    }
  }

  return [];
}

/**
 * 检查两个文本是否为同义词关系
 */
export function areSynonyms(a: string, b: string): boolean {
  const normA = a.toLowerCase().trim();
  const normB = b.toLowerCase().trim();

  if (normA === normB) return true;

  const synonymsA = getSynonyms(normA);
  return synonymsA.some((s) => s.toLowerCase() === normB);
}
