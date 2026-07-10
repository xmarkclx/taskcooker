export type ReplyAttachmentReference = {
  fileName: string;
  markdownPath: string;
};

export function formatReplyWithAttachments(
  message: string,
  attachments: ReplyAttachmentReference[],
): string {
  const body = message.trim();
  if (!attachments.length) {
    return body;
  }

  const attachmentLines = attachments.map(
    (attachment) => `- ${attachment.fileName}: ${attachment.markdownPath}`,
  );
  const attachmentBlock = `Attachments:\n${attachmentLines.join('\n')}`;

  return body ? `${body}\n\n${attachmentBlock}` : attachmentBlock;
}

export function formatTerminalImageReferences(
  attachments: ReplyAttachmentReference[],
): string {
  if (!attachments.length) {
    return '';
  }

  const attachmentLines = attachments.map(
    (attachment) => `- ${attachment.fileName}: ${attachment.markdownPath}`,
  );
  return `\r\n[Image attachments saved by TaskCooker]\r\n${attachmentLines.join(
    '\r\n',
  )}\r\n`;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file.'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.split(',').at(-1) ?? '');
    };
    reader.readAsDataURL(file);
  });
}
