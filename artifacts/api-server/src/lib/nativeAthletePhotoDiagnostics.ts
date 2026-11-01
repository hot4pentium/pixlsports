import { NativeLinkError } from "./nativeIdentity";

export type NativePhotoOperation = "state" | "image" | "save" | "remove";
export type NativePhotoStage =
  | "validation" | "ownership" | "revision"
  | "database_check" | "database_persistence"
  | "storage_write" | "storage_read" | "response";

const unavailable = "PIXL Sports is temporarily unavailable. Please try again.";

// Never retain a cause, stack, code, URL, or other property from a dependency
// error. Even Error.message can contain credentials or private object names.
class NativePhotoFailure extends NativeLinkError {
  constructor(readonly stage: NativePhotoStage, status: number, message: string) {
    super(status, message);
  }
}

export async function nativePhotoStep<T>(stage: NativePhotoStage, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof NativePhotoFailure) throw error;
    const expected = ["validation", "ownership", "revision"].includes(stage)
      && error instanceof NativeLinkError && error.status >= 400 && error.status < 500;
    throw new NativePhotoFailure(
      stage, expected ? error.status : 503, expected ? error.message : unavailable,
    );
  }
}

export function nativePhotoFailureResponse(operation: NativePhotoOperation, error: unknown) {
  const expected = error instanceof NativeLinkError && error.status >= 400 && error.status < 500;
  const status = expected ? error.status : 503;
  return {
    status,
    body: { error: expected ? error.message : unavailable },
    // Reconstruct an allowlisted record; never spread or serialize the error.
    diagnostic: {
      event: "native_athlete_photo_failure",
      operation,
      stage: error instanceof NativePhotoFailure ? error.stage : expected ? "validation" : "response",
      category: expected ? "rejected" : "infrastructure",
      status,
    },
  };
}
