/* global module, wx */
function failure(code, status) {
  return Object.assign(new Error(code), { code, status });
}
function createErpClient(base, platform = wx) {
  const root =
    typeof base === 'string' &&
    /^https:\/\/[a-z\d.-]+(?::\d+)?(?:\/[\w.-]+)*\/?$/i.test(base)
      ? base.replace(/\/$/, '')
      : '';
  let token = '';
  let generation = 0;
  function headers() {
    return token ? { Authorization: 'Bearer ' + token } : {};
  }
  function decode(status, value) {
    if (
      status >= 200 &&
      status < 300 &&
      value &&
      Object.prototype.hasOwnProperty.call(value, 'data')
    )
      return value;
    throw failure(value?.error?.reason || 'REQUEST_FAILED', status);
  }
  async function request(path, method = 'GET', data) {
    if (!root) throw failure('CONFIG_MISSING');
    return new Promise((resolve, reject) =>
      platform.request({
        url: root + '/api' + path,
        method,
        data,
        header: headers(),
        timeout: 15000,
        success(r) {
          try {
            resolve(decode(r.statusCode, r.data));
          } catch (e) {
            reject(e);
          }
        },
        fail() {
          reject(failure('NETWORK'));
        },
      }),
    );
  }
  return {
    configured: !!root,
    request,
    async login(phoneCode) {
      if (!root) throw failure('CONFIG_MISSING');
      const current = ++generation;
      token = '';
      const loginCode = await new Promise((resolve, reject) =>
        platform.login({
          success: (r) =>
            r.code ? resolve(r.code) : reject(failure('WECHAT_LOGIN')),
          fail: () => reject(failure('WECHAT_LOGIN')),
        }),
      );
      const result = await request('/merchantMiniapp/signIn', 'POST', {
        loginCode,
        phoneCode,
      });
      if (typeof result.data?.token !== 'string' || !result.data.token)
        throw failure('REQUEST_FAILED');
      if (generation !== current) throw failure('REQUEST_FAILED');
      token = result.data.token;
    },
    async upload(recordId, filePath) {
      if (!root || !token) throw failure('REQUEST_FAILED', 401);
      return new Promise((resolve, reject) =>
        platform.uploadFile({
          url:
            root +
            '/api/reportingFiles/uploadOne?kind=revenueReports&recordId=' +
            encodeURIComponent(recordId),
          filePath,
          name: 'file',
          header: headers(),
          timeout: 20000,
          success(r) {
            try {
              resolve(decode(r.statusCode, JSON.parse(r.data)));
            } catch (e) {
              reject(e);
            }
          },
          fail() {
            reject(failure('NETWORK'));
          },
        }),
      );
    },
    async downloadEvidence(id, ext) {
      if (!root || !token) throw failure('REQUEST_FAILED', 401);
      if (
        typeof id !== 'string' ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id) ||
        !['png', 'jpeg', 'jpg'].includes(ext)
      )
        throw failure('PROFILE_FILE_TYPE');
      return new Promise((resolve, reject) =>
        platform.downloadFile({
          url: root + '/uploads/reportingEvidence/' + id + '.' + ext,
          header: headers(),
          timeout: 20000,
          success(r) {
            if (r.statusCode === 200 && r.tempFilePath) resolve(r.tempFilePath);
            else
              reject(
                failure(
                  r.statusCode === 403 ? 'MINIAPP_NO_GRANT' : 'REQUEST_FAILED',
                  r.statusCode,
                ),
              );
          },
          fail() {
            reject(failure('NETWORK'));
          },
        }),
      );
    },
    async signout() {
      try {
        if (token) await request('/auth/sign-out', 'POST', {}).catch(() => {});
      } finally {
        token = '';
      }
    },
    clear() {
      generation++;
      token = '';
    },
  };
}
module.exports = { createErpClient };
