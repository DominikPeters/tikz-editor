declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}

declare module "pdfjs-dist/legacy/build/pdf.worker.mjs?url" {
  const workerUrl: string;
  export default workerUrl;
}
