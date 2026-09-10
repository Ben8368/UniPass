declare module "*.html" {
  const content: string;
  export default content;
}

declare module "*.css" {
  const content: string;
  export default content;
}

declare const __UNIPASS_BUILD_TIME__: string;
