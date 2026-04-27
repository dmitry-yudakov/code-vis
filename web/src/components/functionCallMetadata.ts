import { FunctionCallInfo } from '../types';

const yesNo = (val: boolean) => (val ? 'yes' : 'no');

const formatReceiver = (func: FunctionCallInfo): string | null => {
  if (!func.receiverText && !func.receiverKind) {
    return null;
  }

  if (func.receiverText && func.receiverKind) {
    return `${func.receiverText} (${func.receiverKind})`;
  }

  return func.receiverText || func.receiverKind || null;
};

export const getFunctionCallDisplayName = (func: FunctionCallInfo): string =>
  func.calleeText || func.name;

export const getFunctionCallKindClassName = (
  func: FunctionCallInfo
): string => `func-call-kind-${func.callKind || 'call'}`;

export const getFunctionCallTooltipLines = (
  func: FunctionCallInfo
): string[] => {
  const lines: string[] = [`Call: ${getFunctionCallDisplayName(func)}`];

  if (func.calleeText && func.name !== func.calleeText) {
    lines.push(`Terminal name: ${func.name}`);
  }
  if (func.callKind) {
    lines.push(`Kind: ${func.callKind}`);
  }

  const receiver = formatReceiver(func);
  if (receiver) {
    lines.push(`Receiver: ${receiver}`);
  }

  if (func.callChain && func.callChain.length) {
    lines.push(`Chain: ${func.callChain.join(' -> ')}`);
  }
  if (func.isOptional) {
    lines.push('Optional chaining: yes');
  }
  if (typeof func.isBuiltin === 'boolean') {
    lines.push(`Builtin constructor: ${yesNo(func.isBuiltin)}`);
  }

  return lines;
};

export const getFunctionCallTooltip = (func: FunctionCallInfo): string =>
  getFunctionCallTooltipLines(func).join('\n');

export const getFunctionCallHoverMarkdown = (
  func: FunctionCallInfo
): string => {
  const rows = getFunctionCallTooltipLines(func).map((line) => {
    const [title, ...tail] = line.split(': ');
    const value = tail.join(': ');
    if (!value) {
      return `- ${line}`;
    }
    return `- **${title}:** ${value}`;
  });

  return rows.join('\n');
};
