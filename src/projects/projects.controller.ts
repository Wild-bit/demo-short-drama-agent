import { Body, Controller, Get, HttpCode, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@/auth/auth.guard";
import { CurrentUserId } from "@/auth/current-user.decorator";
import { ProjectsService } from "./projects.service";

const uuid = new ParseUUIDPipe({ version: "4" });

@Controller("projects")
@UseGuards(AuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  /** 打开工作台的项目列表。 */
  @Get("list")
  listProjects(@CurrentUserId() userId: string) {
    return this.projects.listProjects(userId);
  }

  /** 重新打开指定项目详情。 */
  @Get("detail")
  getProject(@CurrentUserId() userId: string, @Query("projectId", uuid) projectId: string) {
    return this.projects.getOwnedProject(userId, projectId);
  }

  /** 新建项目，名称来自请求体，归属来自登录凭证。 */
  @Post("create")
  createProject(@CurrentUserId() userId: string, @Body("name") name: unknown) {
    return this.projects.createProject(userId, name);
  }

  /** 删除指定项目及其关联的分镜、确认与项目会话，保留个人素材库。 */
  @Post("delete")
  @HttpCode(200)
  async deleteProject(@CurrentUserId() userId: string, @Body("projectId", uuid) projectId: string) {
    await this.projects.deleteProject(userId, projectId);
    return { deleted: true };
  }
}
