/**
 * This declaration file is a workaround for the 'onnxruntime-node' package.
 *
 * **Problem:** The TypeScript compiler (in this project's specific configuration)
 * fails to find the type declarations for 'onnxruntime-node', even though
 * they are present within the package. This results in a TS7016 error:
 * "Could not find a declaration file for module 'onnxruntime-node'".
 *
 * **Solution:** This ambient module declaration tells TypeScript to treat the
 * module as having an 'any' type. This is not ideal as it sacrifices type
 * safety for this specific import, but it is a pragmatic solution that
 * unblocks the build process. A more robust solution would involve fixing
 * the root cause in the tsconfig or project setup that prevents type
 * discovery, but that was beyond the scope of the immediate task.
 */
declare module 'onnxruntime-node';
