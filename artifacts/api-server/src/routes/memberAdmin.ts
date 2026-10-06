import { Router, type IRouter } from "express";
import {
  DeleteAdminMemberBody,
  DeleteAdminMemberParams,
  DeleteAdminMemberResponse,
  GetAdminMemberParams,
  GetAdminMemberResponse,
  GetAdminSessionResponse,
  ListAdminAuditQueryParams,
  ListAdminAuditResponse,
  ListAdminMembersQueryParams,
  ListAdminMembersResponse,
  UpdateAdminMemberProfileBody,
  UpdateAdminMemberProfileParams,
  UpdateAdminMemberProfileResponse,
  UpdateAdminMemberAdministratorBody,
  UpdateAdminMemberAdministratorParams,
  UpdateAdminMemberAdministratorResponse,
  UpdateAdminMemberSuspensionBody,
  UpdateAdminMemberSuspensionParams,
  UpdateAdminMemberSuspensionResponse,
  UpdateAdminMemberIdentityBlockBody,
  UpdateAdminMemberIdentityBlockParams,
  UpdateAdminMemberIdentityBlockResponse,
  RestoreAdminMemberCancellationBody,
  RestoreAdminMemberCancellationParams,
  RestoreAdminMemberCancellationResponse,
} from "@workspace/api-zod";
import { getRequiredClerkUserId, requireAuthenticatedIdentity } from "../middlewares/requireAuth";
import { hasAdminAccess, requireAdmin } from "../lib/adminAccess";
import {
  AdminRequestError,
  getAdminMember,
  getAdminMemberActionResult,
  listAdminAudit,
  listAdminMembers,
  requestAdminMemberDeletion,
  updateAdminMemberProfile,
  updateAdminMemberAdministrator,
  updateAdminMemberSuspension,
  updateAdminMemberIdentityBlock,
  restoreAdminMemberCancellation,
} from "../lib/memberAdmin";

const router: IRouter = Router();

router.get("/admin/session", requireAuthenticatedIdentity, async (_req, res, next): Promise<void> => {
  try {
    const isAdmin = await hasAdminAccess(getRequiredClerkUserId(res));
    res.json(GetAdminSessionResponse.parse({ isAdmin }));
  } catch (error) {
    next(error);
  }
});

router.get("/admin/members", requireAdmin, async (req, res, next): Promise<void> => {
  const parsed = ListAdminMembersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const result = await listAdminMembers(parsed.data);
    res.json(ListAdminMembersResponse.parse(result));
  } catch (error) {
    next(error);
  }
});

router.get("/admin/members/:userId", requireAdmin, async (req, res, next): Promise<void> => {
  const parsed = GetAdminMemberParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const member = await getAdminMember(parsed.data.userId);
    if (!member) {
      res.status(404).json({ error: "Member account was not found." });
      return;
    }
    res.json(GetAdminMemberResponse.parse(member));
  } catch (error) {
    next(error);
  }
});

router.patch("/admin/members/:userId/profile", requireAdmin, async (req, res, next): Promise<void> => {
  const params = UpdateAdminMemberProfileParams.safeParse(req.params);
  const body = UpdateAdminMemberProfileBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const member = await updateAdminMemberProfile(
      getRequiredClerkUserId(res),
      params.data.userId,
      body.data,
    );
    if (!member) {
      res.status(404).json({ error: "Member account was not found." });
      return;
    }
    res.json(UpdateAdminMemberProfileResponse.parse(member));
  } catch (error) {
    if (error instanceof AdminRequestError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
  }
});

router.patch("/admin/members/:userId/suspension", requireAdmin, async (req, res, next): Promise<void> => {
  const params = UpdateAdminMemberSuspensionParams.safeParse(req.params);
  const body = UpdateAdminMemberSuspensionBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const member = await getAdminMember(params.data.userId);
    if (!member) {
      res.status(404).json({ error: "Member account was not found." });
      return;
    }
    const action = await updateAdminMemberSuspension(
      getRequiredClerkUserId(res),
      params.data.userId,
      body.data.suspended,
      body.data.reason,
    );
    res.json(UpdateAdminMemberSuspensionResponse.parse(action));
  } catch (error) {
    if (error instanceof AdminRequestError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
  }
});

router.patch("/admin/members/:userId/identity-block", requireAdmin, async (req, res, next): Promise<void> => {
  const params = UpdateAdminMemberIdentityBlockParams.safeParse(req.params);
  const body = UpdateAdminMemberIdentityBlockBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const member = await getAdminMember(params.data.userId);
    if (!member) {
      res.status(404).json({ error: "Member account was not found." });
      return;
    }
    const action = await updateAdminMemberIdentityBlock(
      getRequiredClerkUserId(res),
      params.data.userId,
      body.data.blocked,
      body.data.reason,
    );
    res.json(UpdateAdminMemberIdentityBlockResponse.parse(action));
  } catch (error) {
    if (error instanceof AdminRequestError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
  }
});

router.post("/admin/members/:userId/cancellation/restore", requireAdmin, async (req, res, next): Promise<void> => {
  const params = RestoreAdminMemberCancellationParams.safeParse(req.params);
  const body = RestoreAdminMemberCancellationBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const member = await getAdminMember(params.data.userId);
    if (!member) {
      res.status(404).json({ error: "Member account was not found." });
      return;
    }
    const action = await restoreAdminMemberCancellation(
      getRequiredClerkUserId(res),
      params.data.userId,
      body.data.reason,
    );
    res.json(RestoreAdminMemberCancellationResponse.parse(action));
  } catch (error) {
    if (error instanceof AdminRequestError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
  }
});

router.patch("/admin/members/:userId/administrator", requireAdmin, async (req, res, next): Promise<void> => {
  const params = UpdateAdminMemberAdministratorParams.safeParse(req.params);
  const body = UpdateAdminMemberAdministratorBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const action = await updateAdminMemberAdministrator(
      getRequiredClerkUserId(res),
      params.data.userId,
      body.data.administrator,
      body.data.reason,
    );
    if (!action) {
      res.status(404).json({ error: "Member account was not found." });
      return;
    }
    res.json(UpdateAdminMemberAdministratorResponse.parse(action));
  } catch (error) {
    if (error instanceof AdminRequestError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
  }
});

router.post("/admin/members/:userId/delete", requireAdmin, async (req, res, next): Promise<void> => {
  const params = DeleteAdminMemberParams.safeParse(req.params);
  const body = DeleteAdminMemberBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const action = await requestAdminMemberDeletion(
      getRequiredClerkUserId(res),
      params.data.userId,
      body.data.confirmationText,
      body.data.reason,
    );
    if (!action) {
      res.status(404).json({ error: "Member account was not found." });
      return;
    }
    const result = await getAdminMemberActionResult(action.id, params.data.userId);
    if (!result) {
      res.status(404).json({ error: "Deletion status was not found." });
      return;
    }
    res.status(result.status === "completed" ? 200 : 202)
      .json(DeleteAdminMemberResponse.parse(result));
  } catch (error) {
    if (error instanceof AdminRequestError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
  }
});

router.get("/admin/audit", requireAdmin, async (req, res, next): Promise<void> => {
  const parsed = ListAdminAuditQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const dateFilters = [parsed.data.fromDate, parsed.data.toDate].filter((value): value is string => Boolean(value));
  const hasInvalidCalendarDate = dateFilters.some((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value;
  });
  if (hasInvalidCalendarDate) {
    res.status(400).json({ error: "Dates must be valid YYYY-MM-DD calendar dates." });
    return;
  }
  if (parsed.data.fromDate && parsed.data.toDate && parsed.data.fromDate > parsed.data.toDate) {
    res.status(400).json({ error: "The start date must be on or before the end date." });
    return;
  }
  try {
    res.json(ListAdminAuditResponse.parse(await listAdminAudit(parsed.data)));
  } catch (error) {
    next(error);
  }
});

export default router;