/**
 * @name App Store 更新监控
 * @description 监控指定 App Store 应用的多区域更新，支持自定义区域顺序，自动检测新增、更新及已移除的应用，并推送通知。
 * @platform Loon
 * @author sooyaaabo
 */


// --- 配置键 ---
// 存储 App ID 列表的键名
// 示例：444934666,414478124,930368978
const APP_IDS_KEY = 'AppStore_AppID';

// 可选：持久化数据中自定义区域顺序的键名
// 示例：cn,us,hk
const REGIONS_KEY = 'AppStore_Region';

// 存储所有被监控 App 详细信息的键名
const MONITORED_APPS_KEY = 'AppStore_Monitored_Apps';

// --- 主程序 ---
main();

async function main() {
  const appStoreIds = $persistentStore.read(APP_IDS_KEY);
  const storedData = $persistentStore.read(MONITORED_APPS_KEY);

  // 检查是否为首次使用且未配置
  if (!appStoreIds && (!storedData || storedData === '{}' || storedData === '')) {
    const message = `未配置 AppStore AppID，请在本地持久化配置中写入键名 ${APP_IDS_KEY}。`;
    console.log(message);
    $notification.post('App Store 监控未配置', '', message);
    $done();
    return;
  }

  // 处理已配置但清空 AppID 的情况
  const newIds = appStoreIds ? appStoreIds.split(',').map(id => id.trim()).filter(Boolean) : [];
  if (newIds.length === 0) {
    if (storedData && storedData !== '{}' && storedData !== '') {
      console.log('AppStore AppID 列表为空，正在清理所有监控记录...');
      $persistentStore.write('', MONITORED_APPS_KEY);
      console.log('AppStore AppID 清理完成。');
    } else {
      console.log('AppStore AppID 列表为空，无需操作。');
    }
    $done();
    return;
  }

  // 读取已监控的应用数据
  let monitoredData = {};
  if (storedData) {
    try {
      monitoredData = JSON.parse(storedData);
    } catch (e) {
      console.log('解析已监控应用数据失败，将重置数据。');
      monitoredData = {};
    }
  }

  // 1. 处理已删除的应用
  handleDeletions(newIds, monitoredData);

  // 2. 检查应用更新
  const defaultRegions = ['us', 'cn', 'hk', 'mo', 'tw', 'jp', 'kr', 'sg', 'tr'];
  let regions = defaultRegions;
  const customRegionsRaw = $persistentStore.read(REGIONS_KEY);
  let usingCustomRegions = false;

  if (customRegionsRaw) {
    const customRegions = customRegionsRaw
      .split(',')
      .map(r => r.trim().toLowerCase())
      .filter(Boolean);
    if (customRegions.length > 0) {
      regions = customRegions;
      usingCustomRegions = true;
    }
  }

  console.log(
    `查询区域顺序: ${regions.join('→').toUpperCase()}${usingCustomRegions ? ' (自定义)' : ' (默认)'}`
  );
  console.log(`开始检测 ${newIds.length} 个应用更新...`);

  const logs = {
    initial: [],
    updated: [],
    noUpdate: [],
    notFound: [],
  };

  try {
    await Promise.all(
      newIds.map(id => checkAppUpdate(id, monitoredData, regions, logs))
    );

    console.log('');
    if (logs.initial.length > 0) {
      console.log('----- 首次监控 -----');
      logs.initial.forEach(log => console.log(log));
      console.log('------------------\n');
    }
    if (logs.updated.length > 0) {
      console.log('----- 应用更新 -----');
      logs.updated.forEach(log => console.log(log));
      console.log('------------------\n');
    }
    if (logs.noUpdate.length > 0) {
      console.log('----- 无需更新 -----');
      logs.noUpdate.forEach(log => console.log(log));
      console.log('------------------\n');
    }
    if (logs.notFound.length > 0) {
      console.log('----- 未找到应用 -----');
      logs.notFound.forEach(log => console.log(log));
      console.log('--------------------\n');
    }

    $persistentStore.write(JSON.stringify(monitoredData), MONITORED_APPS_KEY);
    console.log('App Store 多区更新检查完成。');
  } catch (error) {
    console.log(`脚本执行出错: ${error}。`);
  } finally {
    $done();
  }
}

function handleDeletions(newIds, monitoredData) {
  const oldIds = Object.keys(monitoredData);
  const deletedIds = oldIds.filter(id => !newIds.includes(id));

  if (deletedIds.length > 0) {
    console.log('----- 应用列表变更 -----');
    deletedIds.forEach(id => {
      const appName = monitoredData[id].name || `ID: ${id}`;
      console.log(`[${appName}] 已从监控列表移除。`);
      delete monitoredData[id];
    });
    console.log('--------------------\n');
  }
}

async function checkAppUpdate(appId, monitoredData, regions, logs) {
  let appInfo = null;
  let regionUsed = '';

  const searchOrder = regions;

  for (const region of searchOrder) {
    appInfo = await lookupApp(region, appId);
    if (appInfo) {
      regionUsed = region;
      break;
    }
  }

  if (!appInfo) {
    logs.notFound.push(
      `[${appId}] 在 ${regions.join(', ').toUpperCase()} 均未找到，请检查AppID是否错误或者请添加新的区域。`
    );
    return;
  }

  const appName = appInfo.trackName;
  const newVersion = appInfo.version;
  const releaseNotes = appInfo.releaseNotes || '暂无更新说明';
  const updateDate = appInfo.currentVersionReleaseDate;
  const storedVersion = monitoredData[appId]?.version || null;

  if (!storedVersion) {
    logs.initial.push(
      `[${regionUsed.toUpperCase()}] ${appName} (ID: ${appId}) 初始化监控，版本 ${newVersion}。`
    );
  } else {
    const cmp = compareVersions(newVersion, storedVersion);
    if (cmp > 0) {
      logs.updated.push(
        `[${regionUsed.toUpperCase()}] ${appName} (ID: ${appId}) 有更新，版本变动 ${storedVersion} → ${newVersion}。`
      );
    } else if (cmp < 0) {
      logs.noUpdate.push(
        `[${regionUsed.toUpperCase()}] ${appName} (ID: ${appId}) 当前版本 (${newVersion}) 低于已记录版本 (${storedVersion})，可能区域变更。`
      );
    } else {
      logs.noUpdate.push(
        `[${regionUsed.toUpperCase()}] ${appName} (ID: ${appId}) 已是最新版本 (${newVersion})，无需更新。`
      );
    }
  }

  // 仅当首次监控 或 新版本 > 旧版本 时推送并更新
  if (!storedVersion || compareVersions(newVersion, storedVersion) > 0) {
    monitoredData[appId] = {
      version: newVersion,
      region: regionUsed,
      name: appName,
    };

    const formattedDate = new Date(updateDate)
      .toLocaleString('zh-CN', {
        hour12: false,
        timeZone: 'Asia/Shanghai',
      })
      .replace(/\//g, '-');

    const openUrl = `https://apps.apple.com/${regionUsed}/app/id${appId}`;
    let title, subtitle, body;

    if (storedVersion) {
      title = `「${appName}」有更新啦！`;
      subtitle = `区域：${regionUsed.toUpperCase()}　版本：${storedVersion} → ${newVersion}`;
      body = `更新时间：${formattedDate}\n更新内容：\n${releaseNotes}`;
    } else {
      title = `「${appName}」已添加监控`;
      subtitle = `区域：${regionUsed.toUpperCase()}　当前版本：${newVersion}`;
      body = `更新时间：${formattedDate}\n将从此版本开始监控更新。`;
    }

    $notification.post(title, subtitle, body, { openUrl });
  } else if (!monitoredData[appId]) {
    // 兜底：确保新 App 被记录
    monitoredData[appId] = {
      version: newVersion,
      region: regionUsed,
      name: appName,
    };
  }
}

function lookupApp(region, appId) {
  return new Promise(resolve => {
    const url = `https://itunes.apple.com/${region}/lookup?id=${appId}`;
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    };

    $httpClient.get({ url, headers }, (error, response, data) => {
      if (error || response?.status !== 200) {
        return resolve(null);
      }
      try {
        const json = JSON.parse(data);
        resolve(json.resultCount > 0 ? json.results[0] : null);
      } catch (e) {
        resolve(null);
      }
    });
  });
}

/**
 * 比较版本，支持 x.y.z 和 x.y.z(nn) 格式
 * 例如：6.8(12) → 主版本 [6,8]，build=12
 */
function compareVersions(v1, v2) {
  try {
    const parse = v => {
      v = String(v).trim();
      let main = v;
      let build = 0;
      const m = v.match(/^(.+?)\s*\((\d+)\)$/);
      if (m) {
        main = m[1].trim();
        build = parseInt(m[2], 10) || 0;
      }
      const parts = main
        .split('.')
        .map(p => {
          const n = parseInt(p, 10);
          return isNaN(n) ? 0 : n;
        });
      return { parts, build };
    };

    const a = parse(v1);
    const b = parse(v2);

    const len = Math.max(a.parts.length, b.parts.length);
    for (let i = 0; i < len; i++) {
      const x = a.parts[i] || 0;
      const y = b.parts[i] || 0;
      if (x > y) return 1;
      if (x < y) return -1;
    }

    if (a.build > b.build) return 1;
    if (a.build < b.build) return -1;
    return 0;
  } catch (e) {
    // 安全回退
    return v1 === v2 ? 0 : v1 > v2 ? 1 : -1;
  }
}