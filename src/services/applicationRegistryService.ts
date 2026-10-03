import mongoose from 'mongoose';
import { TrackedApplication, ITrackedApplicationDocument } from '../models/TrackedApplication';
import { DiscoveredApplication } from '../models/DiscoveredApplication';
import { DEFAULT_REGISTRY_APPLICATIONS, STANDARD_APPLICATION_CATEGORIES } from '../shared/constants';
import { AppError } from '../middleware/errorHandler';
import { emitToCompany } from '../realtime/socketManager';

// Normalizes executable name to lowercase and ensures .exe suffix if missing
export const normalizeExecutableName = (raw: string): string => {
  const trimmed = (raw || '').trim().toLowerCase();
  if (!trimmed) return '';
  // Remove path if a full path was passed into executable name
  const base = trimmed.split(/[\\/]/).pop() || trimmed;
  return base.endsWith('.exe') ? base : `${base}.exe`;
};

export class ApplicationRegistryService {
  /**
   * Seed default applications for a company if none currently exist
   */
  public async seedDefaultApplications(companyId: string): Promise<void> {
    const cId = new mongoose.Types.ObjectId(companyId);
    const count = await TrackedApplication.countDocuments({ companyId: cId });
    if (count > 0) return;

    const docs = DEFAULT_REGISTRY_APPLICATIONS.map((app) => ({
      companyId: cId,
      name: app.name,
      executableNames: app.executableNames.map(normalizeExecutableName),
      executablePaths: [],
      category: app.category,
      tracked: app.tracked,
      ignored: app.ignored,
      isSystemApp: app.isSystemApp
    }));

    try {
      await TrackedApplication.insertMany(docs, { ordered: false });
    } catch (err: any) {
      // Ignore partial duplicates if race condition occurred
      console.warn('[ApplicationRegistryService] Seed warning:', err.message);
    }
  }

  /**
   * Get all registered applications with optional filters
   */
  public async getApplications(
    companyId: string,
    filter: { category?: string; search?: string; tracked?: boolean }
  ) {
    await this.seedDefaultApplications(companyId);

    const cId = new mongoose.Types.ObjectId(companyId);
    const query: any = { companyId: cId };

    if (filter.category && filter.category !== 'All') {
      query.category = filter.category;
    }

    if (filter.tracked !== undefined) {
      query.tracked = filter.tracked;
    }

    if (filter.search) {
      const regex = new RegExp(filter.search.trim(), 'i');
      query.$or = [{ name: regex }, { executableNames: regex }, { category: regex }];
    }

    const apps = await TrackedApplication.find(query)
      .sort({ isSystemApp: 1, tracked: -1, name: 1 })
      .lean();

    return apps.map((app) => ({
      id: app._id.toString(),
      _id: app._id.toString(),
      companyId: app.companyId.toString(),
      name: app.name,
      executableNames: app.executableNames,
      executablePaths: app.executablePaths || [],
      category: app.category,
      tracked: app.tracked,
      ignored: app.ignored,
      isSystemApp: app.isSystemApp,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt
    }));
  }

  /**
   * Add a new application to the company's registry
   */
  public async addApplication(
    companyId: string,
    data: {
      name: string;
      category: string;
      executableNames: string[];
      executablePaths?: string[];
      tracked?: boolean;
      ignored?: boolean;
      isSystemApp?: boolean;
    }
  ) {
    await this.seedDefaultApplications(companyId);
    const cId = new mongoose.Types.ObjectId(companyId);

    const cleanName = data.name.trim();
    if (!cleanName) {
      throw new AppError('Application name is required', 400);
    }

    const normalizedExes = Array.from(
      new Set(
        (data.executableNames || [])
          .map(normalizeExecutableName)
          .filter((exe) => exe.length > 0)
      )
    );

    if (normalizedExes.length === 0) {
      throw new AppError('At least one executable name (e.g. Code.exe) is required', 400);
    }

    // Check for duplicate executables in existing applications for this company
    const existingConflict = await TrackedApplication.findOne({
      companyId: cId,
      executableNames: { $in: normalizedExes }
    });

    if (existingConflict) {
      const conflictingNames = normalizedExes.filter((e) =>
        existingConflict.executableNames.includes(e)
      );
      throw new AppError(
        `Executable "${conflictingNames.join(', ')}" is already registered under "${existingConflict.name}".`,
        409
      );
    }

    const tracked = data.tracked !== undefined ? data.tracked : true;
    const ignored = data.ignored !== undefined ? data.ignored : !tracked;

    const created = await TrackedApplication.create({
      companyId: cId,
      name: cleanName,
      executableNames: normalizedExes,
      executablePaths: data.executablePaths || [],
      category: data.category || 'Other',
      tracked,
      ignored,
      isSystemApp: Boolean(data.isSystemApp)
    });

    // Mark any corresponding discovered records as resolved
    await DiscoveredApplication.updateMany(
      { companyId: cId, executableName: { $in: normalizedExes } },
      { $set: { status: tracked ? 'TRACKED' : 'IGNORED' } }
    );

    // Broadcast config update
    emitToCompany(companyId, 'applications:updated', {
      companyId,
      version: Date.now()
    });

    return created;
  }

  /**
   * Update an existing application
   */
  public async updateApplication(
    companyId: string,
    appId: string,
    data: {
      name?: string;
      category?: string;
      executableNames?: string[];
      executablePaths?: string[];
      tracked?: boolean;
      ignored?: boolean;
    }
  ) {
    const cId = new mongoose.Types.ObjectId(companyId);
    const existing = await TrackedApplication.findOne({ _id: appId, companyId: cId });
    if (!existing) {
      throw new AppError('Application not found in registry', 404);
    }

    if (data.name) existing.name = data.name.trim();
    if (data.category) existing.category = data.category.trim();

    if (data.executableNames && data.executableNames.length > 0) {
      const normalizedExes = Array.from(
        new Set(data.executableNames.map(normalizeExecutableName).filter(Boolean))
      );

      // Verify no conflict with another application
      const conflict = await TrackedApplication.findOne({
        companyId: cId,
        _id: { $ne: existing._id },
        executableNames: { $in: normalizedExes }
      });

      if (conflict) {
        throw new AppError(
          `Executable is already assigned to application "${conflict.name}".`,
          409
        );
      }

      existing.executableNames = normalizedExes;
    }

    if (data.executablePaths !== undefined) {
      existing.executablePaths = data.executablePaths;
    }

    if (data.tracked !== undefined) {
      existing.tracked = data.tracked;
      existing.ignored = !data.tracked;
    }

    if (data.ignored !== undefined) {
      existing.ignored = data.ignored;
      if (data.ignored) existing.tracked = false;
    }

    await existing.save();

    emitToCompany(companyId, 'applications:updated', {
      companyId,
      version: Date.now()
    });

    return existing;
  }

  /**
   * Toggle tracking status for an application
   */
  public async toggleTracking(companyId: string, appId: string, tracked: boolean) {
    const cId = new mongoose.Types.ObjectId(companyId);
    const app = await TrackedApplication.findOne({ _id: appId, companyId: cId });
    if (!app) {
      throw new AppError('Application not found', 404);
    }

    app.tracked = tracked;
    app.ignored = !tracked;
    await app.save();

    emitToCompany(companyId, 'applications:updated', {
      companyId,
      version: Date.now()
    });

    return app;
  }

  /**
   * Delete an application from the registry
   */
  public async deleteApplication(companyId: string, appId: string) {
    const cId = new mongoose.Types.ObjectId(companyId);
    const app = await TrackedApplication.findOne({ _id: appId, companyId: cId });
    if (!app) {
      throw new AppError('Application not found', 404);
    }

    if (app.isSystemApp) {
      throw new AppError('System applications cannot be deleted', 400);
    }

    await TrackedApplication.deleteOne({ _id: appId, companyId: cId });

    emitToCompany(companyId, 'applications:updated', {
      companyId,
      version: Date.now()
    });

    return { success: true };
  }

  /**
   * Retrieve lightweight configuration for the desktop agent
   */
  public async getAgentConfig(companyId: string, clientVersion?: number) {
    await this.seedDefaultApplications(companyId);
    const cId = new mongoose.Types.ObjectId(companyId);

    const latest = await TrackedApplication.findOne({ companyId: cId })
      .sort({ updatedAt: -1 })
      .select('updatedAt')
      .lean();
    const currentVersion = latest?.updatedAt ? new Date(latest.updatedAt).getTime() : 1;

    if (clientVersion && Number(clientVersion) === currentVersion) {
      return {
        version: currentVersion,
        upToDate: true,
        applications: []
      };
    }

    const apps = await TrackedApplication.find({ companyId: cId })
      .select('name executableNames executablePaths category tracked ignored isSystemApp updatedAt')
      .lean();

    return {
      version: currentVersion,
      upToDate: false,
      applications: apps.map((a) => ({
        id: a._id.toString(),
        name: a.name,
        executableNames: a.executableNames,
        executablePaths: a.executablePaths || [],
        category: a.category,
        tracked: a.tracked,
        ignored: a.ignored,
        isSystemApp: a.isSystemApp
      }))
    };
  }

  /**
   * Record an unknown application discovered by the desktop agent
   */
  public async recordDiscoveredApp(
    companyId: string,
    employeeId: string | undefined,
    data: { executableName: string; executablePath?: string; windowTitle?: string }
  ) {
    const cId = new mongoose.Types.ObjectId(companyId);
    const normalizedExe = normalizeExecutableName(data.executableName);

    if (!normalizedExe || normalizedExe === 'unknown.exe' || normalizedExe.includes('telemetry')) {
      return null;
    }

    // Check if already in TrackedApplication registry
    const registered = await TrackedApplication.findOne({
      companyId: cId,
      executableNames: normalizedExe
    });
    if (registered) return null;

    const empObjId = employeeId && mongoose.Types.ObjectId.isValid(employeeId)
      ? new mongoose.Types.ObjectId(employeeId)
      : undefined;

    const doc = await DiscoveredApplication.findOneAndUpdate(
      { companyId: cId, executableName: normalizedExe },
      {
        $inc: { detectedTimes: 1 },
        $set: {
          lastSeenAt: new Date(),
          ...(data.executablePath && { executablePath: data.executablePath }),
          ...(data.windowTitle && { windowTitle: data.windowTitle }),
          ...(empObjId && { lastSeenByEmployeeId: empObjId })
        },
        $setOnInsert: {
          firstSeenAt: new Date(),
          status: 'DISCOVERED'
        }
      },
      { upsert: true, new: true }
    );

    return doc;
  }

  /**
   * Get pending discovered applications
   */
  public async getDiscoveredApplications(companyId: string) {
    const cId = new mongoose.Types.ObjectId(companyId);
    return DiscoveredApplication.find({ companyId: cId, status: 'DISCOVERED' })
      .sort({ lastSeenAt: -1 })
      .populate('lastSeenByEmployeeId', 'employeeCode')
      .lean();
  }

  /**
   * Convert a discovered application to tracked or ignored
   */
  public async convertDiscovered(
    companyId: string,
    discoveredId: string,
    data: { name?: string; category?: string; tracked: boolean; ignored?: boolean }
  ) {
    const cId = new mongoose.Types.ObjectId(companyId);
    const discovered = await DiscoveredApplication.findOne({ _id: discoveredId, companyId: cId });
    if (!discovered) {
      throw new AppError('Discovered application record not found', 404);
    }

    const rawBase = discovered.executableName.replace(/\.exe$/i, '');
    const cleanName = (data.name || rawBase).trim();
    const formattedName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);

    const app = await this.addApplication(companyId, {
      name: formattedName,
      category: data.category || 'Other',
      executableNames: [discovered.executableName],
      executablePaths: discovered.executablePath ? [discovered.executablePath] : [],
      tracked: data.tracked,
      ignored: data.ignored !== undefined ? data.ignored : !data.tracked
    });

    discovered.status = data.tracked ? 'TRACKED' : 'IGNORED';
    await discovered.save();

    return app;
  }

  /**
   * Dismiss a discovered application
   */
  public async dismissDiscovered(companyId: string, discoveredId: string) {
    const cId = new mongoose.Types.ObjectId(companyId);
    await DiscoveredApplication.deleteOne({ _id: discoveredId, companyId: cId });
    return { success: true };
  }
}

export const applicationRegistryService = new ApplicationRegistryService();
