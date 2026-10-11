"use strict";

// 语义停点的写入与续跑：把待命名表 / 译文 / 术语表写回工程，再从「刚写的文件所喂的第一步」接着跑。
// 人填（/api/confirm）与模型填（lib/autofill.js）走的是同一份实现 —— 同一逻辑只有一个实现。

const { UserError } = require("./errors.js");
const { INPUT_FILES, stepsEatingInput } = require("./plugin.js");
const pageProgress = require("./page-progress.js");

/*
 * 写回之后从哪一步续：纯函数 —— 入参是「这一次写了哪几类文件」「步骤契约」「登记表里跑过的步骤」
 * 与「来源运行自己那几步」，出参是步骤名（空串＝没有可续的锚点）。commit 只管写文件与起运行，
 * 锚点这段怎么算可以单独验。
 *
 * 两个候选取更早的那一个：
 *   刚写入的文件所喂的第一步 —— 它下游要重算（第 11 步门禁因临时语言键失败、回头补全译文之后，
 *   必须从吃译文清单那一步重算；只续门禁会拿旧的 Bundle 清单再报一次同样的错）；
 *   登记表里第一条没跑成的那一步 —— 它本来就没跑成，跳过它只会拿缺的产物去撞门禁
 *   （第 8 步因缺分组表停下、回来只补译文时，直接跳第 9 步会报「输入 layoutManifest 未登记」）。
 * 「哪一步吃刚写入的那个文件」由插件契约自己说（那一步的 Inputs 里写着文件名，判据见
 * lib/plugin.js 的 stepsEatingInput）；谁在前由契约的次序定，这里不写死步骤名与编号。
 */
function resolveResumeStep(input) {
  const contract = Array.isArray(input.contract) ? input.contract : [];
  const runSteps = input.runSteps || null;

  /* 契约里的次序：两个候选取更早的那一个，得知道谁在前。 */
  const orderOf = function (name) {
    const hit = contract.find(function (step) { return String(step.Name) === String(name); });
    return hit ? Number(hit.Id) : Number.MAX_SAFE_INTEGER;
  };
  /* 某一步的编号：来源运行自己那几步优先（那一趟真跑过的），没有才按契约查。 */
  const stepEntry = function (name) {
    if (!name) return null;
    if (runSteps) {
      for (const table of runSteps) {
        const hit = Object.values(table).find(function (step) { return step.name === name; });
        if (hit) return { id: hit.id, name: hit.name };
      }
      return null;
    }
    const hit = contract.find(function (step) { return String(step.Name) === String(name); });
    return hit ? { id: Number(hit.Id), name: String(hit.Name) } : null;
  };
  const anchorOf = function (file) {
    const step = stepsEatingInput(contract, [file])[0];
    return stepEntry(step ? step.Name : "");
  };

  const anchors = [];
  // 命名表与「空台账声明」都喂吃命名表那一步；译文喂吃译文清单那一步；分组表喂吃分组表那一步。
  if (input.wroteNaming || input.allowEmptyLedger) anchors.push(anchorOf(INPUT_FILES.naming));
  if (input.wroteTranslations) anchors.push(anchorOf(INPUT_FILES.translations));
  if (input.wroteGroups) anchors.push(anchorOf(INPUT_FILES.groups));
  const earliest = anchors.filter(Boolean).sort(function (left, right) { return left.id - right.id; })[0];

  const unfinished = pageProgress.unfinishedStepOf(input.registrySteps, contract);
  const candidates = [earliest ? String(earliest.name) : "", unfinished].filter(Boolean);
  return candidates.sort(function (left, right) { return orderOf(left) - orderOf(right); })[0] || "";
}

function createConfirm(deps) {
  const runs = deps.runs;
  const pending = deps.pending;
  // 取步骤契约：内存里那次运行没了（客户端重启）时，续跑锚点改从契约里按名字找。
  const steps = deps.steps || function () { return []; };
  // 插件登记表（哪几步真的跑成了）：与 lib/board.js 一样是必给依赖 —— 缺了不静默降级，装配处忘了会当场炸。
  const artifacts = deps.artifacts;

  function commit(body) {
    const written = [];
    let wroteNaming = false;
    let wroteTranslations = false;
    let wroteGroups = false;
    // 空命名表不写：插件的 build-icon-ledger 会因为「命名表为空」直接报错，
    // 它要求的做法是显式声明 -AllowEmptyLedger，而不是喂一张空表。
    if (Array.isArray(body.naming) && body.naming.length > 0) {
      written.push(pending.writeNaming({ projectRoot: body.projectRoot, target: body.target, items: body.naming }));
      wroteNaming = true;
    }
    if (body.translations && typeof body.translations === "object" && Object.keys(body.translations).length > 0) {
      written.push(pending.writeTranslations({ projectRoot: body.projectRoot, target: body.target, map: body.translations }));
      wroteTranslations = true;
    }
    if (body.glossary && typeof body.glossary === "object" && Object.keys(body.glossary).length > 0) {
      written.push(pending.writeGlossary({ projectRoot: body.projectRoot, target: body.target, map: body.glossary }));
      // 术语表与译文清单是同一步的可选输入（契约第 9 步 inputs 里写着「术语表可选」），
      // 所以只补术语表也锚到吃译文清单那一步 —— 续跑锚点按文件找，不按步骤名。
      wroteTranslations = true;
    }
    /*
     * 分组表喂 layout 步骤：写回后从 layout 续跑。
     * 空数组也照写 —— 那是显式声明「本页没有要声明的分组」，插件按表在不在判（有图无表才停），
     * 空表让它照常走机械判据；不写的话这一页永远解不开「有图无表」。
     */
    if (Array.isArray(body.groups)) {
      written.push(pending.writeGroups({ projectRoot: body.projectRoot, target: body.target, groups: body.groups }));
      wroteGroups = true;
    }
    /*
     * 命名表被写歪（留着插件不认的旧下标，或资源名撞在一起）：这次提交不只是补名字，
     * 还要把表修回台账口径 —— 第 7 步就是因为这些才拒绝的。
     * 修完算一次「写」，否则这种情况会被 NOTHING_TO_WRITE 挡掉（本来就没有新名字要写）。
     */
    if (body.pruneNaming === true) {
      const fixed = pending.reconcileNaming({ projectRoot: body.projectRoot, target: body.target });
      if (fixed && (fixed.removed > 0 || fixed.renamed > 0)) {
        written.push({ path: fixed.path, count: fixed.kept });
        wroteNaming = true;
      }
    }
    // 空台账这条路要求命名表文件不存在（见 pending.clearNaming 的说明）。
    if (body.allowEmptyLedger === true) {
      pending.clearNaming({ projectRoot: body.projectRoot, target: body.target });
    }
    if (written.length === 0 && body.allowEmptyLedger !== true) {
      throw new UserError("NOTHING_TO_WRITE", "没有要提交的内容", "至少提交命名表、译文清单、分组表，或勾选「按空台账继续」。");
    }
    if (body.resume === false) return { written: written, job: null };

    /*
     * 续跑必须有一条精确的来源运行：没有就明说，不让运行管理器退回「最近一次运行」——
     * 那会把另一页的 fileId / layerId / ui 配着本页的工程目录写进去，而且不报错。
     * 手填的条目（工程目录不在任何已知运行里）只写文件，走 resume=false 那条路。
     */
    const runId = String(body.runId || "").trim();
    if (!runId) {
      throw new UserError("NO_SOURCE", "这条待确认没有来源运行", "从看板那一行或流水线详情点「继续」；手填只能写入文件，不能续跑。");
    }
    // 从上一轮运行继承参数；从哪一步续由 resolveResumeStep 算（只按登记表与写回的文件判，不写死步骤名）。
    const job = runs.status(runId);
    /*
     * 契约：进程里缓存的那一份（起运行时就读过，不为一次提交再起一个 pwsh）；这一份进程还没起过运行
     * 才现读一次插件契约。
     */
    const contractSteps = function () {
      const cached = runs.contract ? runs.contract() : [];
      return cached.length > 0 ? cached : steps();
    };
    const resumeStep = resolveResumeStep({
      wroteNaming: wroteNaming,
      wroteTranslations: wroteTranslations,
      wroteGroups: wroteGroups,
      allowEmptyLedger: body.allowEmptyLedger === true,
      contract: contractSteps(),
      // 这一页的登记表里跑过的步骤（读法只有一处：lib/artifacts.js 的 stepsOf）。
      registrySteps: artifacts.stepsOf({ projectRoot: body.projectRoot, target: body.target }),
      // 来源运行自己那几步：有它就按它查步号（那一趟真跑过的），没有才按契约查。
      runSteps: job ? job.runs.map(function (run) { return run.steps; }) : null
    });
    // 内存里那次运行没了也能续：任务自己带着请求参数，锚点从契约里取。
    const request = job ? job.request : (body.request || null);
    if (!request || !resumeStep) {
      return {
        written: written,
        job: null,
        note: request
          ? "已写入；这次没有可续跑的锚点：登记表里没有没跑成的步骤，写回的文件也没找到吃它的那一步。"
          : "已写入；没有可续跑的上一次运行（找不到上次运行）。"
      };
    }
    return {
      written: written,
      mode: request.mode,
      resumedFrom: resumeStep,
      job: runs.start({
        projectRoot: body.projectRoot || request.projectRoot,
        target: body.target || request.target,
        fileId: request.fileId,
        layerId: request.layerId,
        ui: request.ui,
        mode: request.mode,
        // 续跑保持同一个发起方：看板任务续跑之后仍然是看板任务，不能变成「流水线」页的运行。
        origin: request.origin === "board" ? "board" : "pipeline",
        // 待确认续跑是一次转换的继续，产物就是它自己写的。
        overwrite: true,
        progress: resumeStep,
        allowEmptyLedger: body.allowEmptyLedger === true
      })
    };
  }

  return { commit };
}

module.exports = { createConfirm, resolveResumeStep };
