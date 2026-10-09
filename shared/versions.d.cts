// 版本比法共享模块的类型声明：给前端 TypeScript 解析 shared/versions.cjs 用，运行期不需要。
export function isVersionName(name: unknown): boolean;
export function compareVersions(a: string, b: string): number;
export function isNewer(candidate: string, current: string): boolean;
