import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const outDir = path.join(skillRoot, 'exports', 'testcases-supplement-logic');

fs.mkdirSync(outDir, { recursive: true });

const testCases = [
  {module:'自营请款-手续费统计',scenario:'正向统计',title:'按项目筛选自营请款单，去重关联出款单并获取出款流水',steps:['进入手续费统计功能页面','选择一个有自营请款记录的项目','查看系统是否根据项目下自营请款单关联对应的出款单','验证出款单关联到的出款流水是否展示在结果中'],expectedResult:'系统正确找出当前项目下所有自营请款单（去重），关联到对应的出款单，并展示对应的出款流水',priority:'P1',testType:'功能'},
  {module:'自营请款-手续费统计',scenario:'正向统计',title:'按出款流水交易时间统计当月手续费（有数据）',steps:['进入手续费统计功能页面','选择一个当月有出款流水的项目','核对系统统计的手续费金额'],expectedResult:'系统仅统计交易时间属于当月的出款流水手续费，金额与对应流水的手续费合计一致',priority:'P1',testType:'功能'},
  {module:'自营请款-手续费统计',scenario:'边界条件',title:'当前项目下无自营请款单',steps:['进入手续费统计功能页面','选择一个没有任何自营请款单的项目','查看统计结果'],expectedResult:'系统展示空结果或提示"当前项目无自营请款数据"，不展示任何手续费记录',priority:'P2',testType:'功能'},
  {module:'自营请款-手续费统计',scenario:'边界条件',title:'出款流水交易时间跨月时只统计当月数据',steps:['准备一个项目，其出款流水包含上月和当月的交易记录','进入手续费统计功能','核对统计结果'],expectedResult:'系统只将当月交易出款流水计入统计，上月流水不纳入当月手续费合计数',priority:'P2',testType:'功能'},
  {module:'自营请款-手续费统计',scenario:'边界条件',title:'同一出款单内多条出款流水对应不同交易月',steps:['准备一个出款单，其关联的多条出款流水分属不同月份','进入当月手续费统计','核对结果'],expectedResult:'系统仅统计属于当月的出款流水，其他月份的流水不纳入当月合计',priority:'P2',testType:'功能'},
  {module:'自营请款-手续费统计',scenario:'异常处理',title:'出款流水缺失交易时间字段',steps:['构造或等待出现一条出款流水交易时间为空的数据','进入手续费统计功能','查看系统如何处理该条流水'],expectedResult:'系统不会因缺失交易时间而崩溃；该条流水不应计入当月统计，建议在日志或界面上提示异常数据条目',priority:'P2',testType:'异常'},
  {module:'承包商请款-手续费统计',scenario:'正向统计',title:'按客户名称+IC PayLink费用类型筛选并去重关联出款单',steps:['进入承包商请款手续费统计功能','选择一个有承包商请款记录的项目','核对系统是否根据客户名称+费用类型组合去重关联出款单','验证展示的出款流水是否正确'],expectedResult:'系统按"客户名称+IC PayLink费用类型"唯一组合找出承包商请款单（去重），关联到对应出款单并展示出款流水',priority:'P1',testType:'功能'},
  {module:'承包商请款-手续费统计',scenario:'正向统计',title:'按出款流水交易时间统计当月手续费',steps:['进入承包商请款手续费统计功能','选择一个当月有承包商出款流水的项目','核对统计结果'],expectedResult:'系统仅统计交易时间属于当月的出款流水手续费，金额计算正确',priority:'P1',testType:'功能'},
  {module:'承包商请款-手续费统计',scenario:'边界条件',title:'同一客户名称不同费用类型分别统计',steps:['准备一个项目，某客户同时关联IC PayLink费用类型A和费用类型B的请款单','进入统计功能','核对结果'],expectedResult:'系统将费用类型A和费用类型B视为不同的统计维度，分别去重和统计，互不干扰',priority:'P2',testType:'功能'},
  {module:'承包商请款-手续费统计',scenario:'边界条件',title:'无匹配承包商请款单',steps:['选择一个没有承包商请款记录的项目','进入统计功能','查看结果'],expectedResult:'系统展示空结果或提示"当前项目无承包商请款数据"',priority:'P2',testType:'功能'},
  {module:'承包商请款-手续费统计',scenario:'异常处理',title:'重复的客户名称+费用类型组合去重后统计正确',steps:['准备数据：同一客户+同一费用类型存在多笔请款单，关联到不同出款单','进入统计功能','核对结果'],expectedResult:'系统对该组合的请款单做去重处理，不会因重复数据导致手续费重复统计',priority:'P2',testType:'异常'},
  {module:'承包商请款-三级分摊规则',scenario:'第一级：对方账户+币种+金额',title:'对方账户名称+币种+金额唯一匹配到人员明细ID，手续费归属正确',steps:['构造一条出款流水，其对方账户名称+币种+金额组合在系统中唯一匹配到某人员明细ID','触发分摊计算','核对手续费归属'],expectedResult:'该条手续费直接归属到该人员明细ID所在的项目，金额100%归属',priority:'P1',testType:'功能'},
  {module:'承包商请款-三级分摊规则',scenario:'第一级：对方账户+币种+金额',title:'对方账户名称+币种+金额匹配到多个人员明细ID（降级到第二级）',steps:['构造一条出款流水，其对方账户名称+币种+金额组合匹配到多个人员明细ID','触发分摊计算','核对系统行为'],expectedResult:'系统判定无法唯一匹配，不按第一级分摊，自动进入第二级（金额+币种）继续匹配',priority:'P1',testType:'功能'},
  {module:'承包商请款-三级分摊规则',scenario:'第二级：金额+币种',title:'金额+币种唯一匹配到人员明细ID',steps:['构造数据使第一级无法唯一匹配，但金额+币种组合能唯一匹配到某人员明细ID','触发分摊计算','核对手续费归属'],expectedResult:'系统按金额+币种唯一匹配，手续费归属到该人员明细ID所在的项目',priority:'P1',testType:'功能'},
  {module:'承包商请款-三级分摊规则',scenario:'第二级：金额+币种',title:'金额+币种匹配到多个人员明细ID（降级到第三级兜底）',steps:['构造数据使前两级均无法唯一匹配（金额+币种有多个候选）','触发分摊计算','核对系统行为'],expectedResult:'系统判定无法唯一匹配，进入第三级兜底分摊逻辑',priority:'P1',testType:'功能'},
  {module:'承包商请款-三级分摊规则',scenario:'第三级：兜底分摊',title:'按候选项目未匹配人数分摊手续费',steps:['构造数据使前两级均无法唯一匹配，候选项目有2个，未匹配人数分别为3人和2人','触发分摊计算','核对分摊结果'],expectedResult:'系统按未匹配人数比例分摊：A项目获得3/5的手续费，B项目获得2/5的手续费',priority:'P1',testType:'功能'},
  {module:'承包商请款-三级分摊规则',scenario:'第三级：兜底分摊',title:'兜底分摊中最后一个项目按总金额相减进行归并',steps:['构造数据进入兜底分摊，3个候选项目按人数比例为5:3:2','触发分摊并验证最后一个项目金额'],expectedResult:'前两个项目按比例计算金额，最后一个项目的金额=总手续费-前两个项目已分摊金额之和（差额尾数归并到最后一个项目）',priority:'P1',testType:'功能'},
  {module:'承包商请款-三级分摊规则',scenario:'组合验证',title:'同一出款单内部分流水走规则①、部分走规则②、部分走规则③',steps:['构造一个出款单包含3条出款流水：分别对应三级规则各一条','触发分摊计算','核对每条流水的归属结果'],expectedResult:'各条流水按自身条件独立匹配对应的分摊级别，互不干扰，每一条的手续费归属均正确',priority:'P2',testType:'功能'},
  {module:'兜底分摊逻辑',scenario:'正向流程',title:'2个候选项目按未匹配人数比例分摊',steps:['构造数据：2个候选项目，未匹配人数分别为4人和6人','触发月底分摊计算','核对分摊结果'],expectedResult:'系统按4:6比例分摊，A项目获得总手续费的40%，B项目获得60%',priority:'P1',testType:'功能'},
  {module:'兜底分摊逻辑',scenario:'正向流程',title:'仅1个候选项目时手续费直接归属',steps:['构造数据：候选项目仅有1个','触发分摊计算','核对结果'],expectedResult:'系统不执行分摊计算，该笔手续费直接归属到该唯一候选项目',priority:'P1',testType:'功能'},
  {module:'兜底分摊逻辑',scenario:'正向流程',title:'月底统一触发分摊计算',steps:['在当前月最后一天或次月第一天触发分摊任务','检查分摊是否执行'],expectedResult:'系统在月底统一执行兜底分摊计算，对当月所有进入兜底的手续费记录进行分摊',priority:'P2',testType:'功能'},
  {module:'兜底分摊逻辑',scenario:'边界条件',title:'未匹配人数为0（所有出款流水均已关联人员）',steps:['构造数据：出款单内所有出款流水均已成功匹配到人员明细ID，未匹配人数=0','触发分摊计算','核对结果'],expectedResult:'系统不执行兜底分摊，提示或记录"无可分摊记录"',priority:'P2',testType:'边界'},
  {module:'兜底分摊逻辑',scenario:'边界条件',title:'人数分摊遇到小数位时余数归入最后一个项目',steps:['构造数据：总手续费100元，3个候选项目按2:3:5人数比例分摊','触发分摊并进行精度验证'],expectedResult:'前两个项目按舍入规则计算金额，最后一个项目金额=总手续费-前两个项目之和，确保总金额正确',priority:'P2',testType:'边界'},
  {module:'兜底分摊逻辑',scenario:'异常处理',title:'候选项目列表为空时系统容错',steps:['构造极端数据：兜底分摊时候选项目为空','触发分摊计算','查看系统行为'],expectedResult:'系统不崩溃，应有日志记录或错误提示，该笔手续费标记为待处理或异常状态',priority:'P2',testType:'异常'},
  {module:'范围排除与备注',scenario:'功能范围',title:'手续费调差逻辑标记为本期暂不实现',steps:['查阅需求文档确认手续费调差逻辑的状态'],expectedResult:'手续费调差已明确标注为"暂不考虑"，本期不生成该模块的测试用例，后续恢复时需重新评估回归范围',priority:'P3',testType:'文档'},
];

const data = {
  prefix: 'SUPPLOGIC',
  documentSummary: {
    name: '补充逻辑：出款流水手续费分摊',
    type: 'docx-requirement',
    parseResult: '已从 DOCX 提取两个主体需求：自营请款手续费统计、承包商请款手续费统计与三级分摊规则',
    missingInfo: '未覆盖跨项目查询范围、当前月口径定义、金额精度舍入规则、调差逻辑未来恢复时的回归点'
  },
  requirementSummary: [
    '自营请款：按项目维度去重关联出款单，按交易时间统计当月手续费',
    '承包商请款：按客户名称+IC PayLink费用类型去重关联出款单，按交易时间统计当月手续费',
    '承包商请款：三级递进分摊规则（对方账户+币种+金额 → 金额+币种 → 未匹配人数兜底）',
    '兜底分摊：月底统一触发，按未匹配人数分摊，最后一项按总金额相减归并',
    '手续费调差逻辑：本期暂不实现'
  ],
  openQuestions: [
    '当前月的统计口径: 自然月、账单月还是交易所在月？',
    '承包商场景下"客户名称+IC PayLink 费用类型"的去重匹配范围是否跨项目？',
    '三级分摊中金额精度规则：小数位保留几位、舍入方式、最后一笔差额归并精确到哪位？',
    '未匹配人数的确切定义是否等于"出款单内全部人员明细数 - 已匹配到人员明细ID的出款流水数"？'
  ],
  testScope: [
    '自营请款 - 手续费统计逻辑（正向+边界+异常）',
    '承包商请款 - 手续费统计逻辑（正向+边界+异常）',
    '承包商请款 - 三级递进分摊规则（逐级验证+组合验证）',
    '兜底分摊逻辑（多候选项目+单候选+无候选+舍入边界）',
    '手续费调差：范围排除标记'
  ],
  risks: [
    '手续费调差逻辑已标注"暂不考虑"，但需求未明确该模块后续恢复时的回归策略',
    '金额精度（小数位舍入规则、末位差额归并方式）仅有模糊描述，缺少明确规范',
    '未匹配人数的计算公式依赖两个基础数据（全部人员明细数、已匹配ID的流水数），任一个数据异常将影响分摊结果',
    '承包商场景中"客户名称+费用类型"的组合去重可能存在跨项目同名客户导致统计错误'
  ],
  testCases: testCases
};

const jsonStr = JSON.stringify(data);
const scriptPath = path.join(skillRoot, 'scripts', 'export-testcases.ps1');

const child = spawn('powershell', [
  '-ExecutionPolicy', 'Bypass',
  '-File', scriptPath,
  '-InputJsonText', jsonStr,
  '-OutputDir', outDir,
], { stdio: ['ignore', 'pipe', 'pipe'] });

let stdout = '', stderr = '';
child.stdout.on('data', d => stdout += d);
child.stderr.on('data', d => stderr += d);
child.on('close', code => {
  console.log('Exit code:', code);
  console.log('STDOUT:', stdout);
  if (stderr) console.log('STDERR:', stderr);
  const entries = fs.readdirSync(outDir);
  console.log('Files in output:', entries);
  const mdPath = path.join(outDir, 'testcases.md');
  if (fs.existsSync(mdPath)) {
    const md = fs.readFileSync(mdPath, 'utf8');
    console.log('--- MD (first 2000 chars) ---');
    console.log(md.substring(0, 2000));
  }
});
