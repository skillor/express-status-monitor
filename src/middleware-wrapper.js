const fs = require('fs');
const path = require('path');
const onHeaders = require('on-headers');
const Handlebars = require('handlebars');
const validate = require('./helpers/validate');
const onHeadersListener = require('./helpers/on-headers-listener');
const socketIoInit = require('./helpers/socket-io-init');
const healthChecker = require('./helpers/health-checker');

const middlewareWrapper = config => {
  const validatedConfig = validate(config);
  const bodyClasses = Object.keys(validatedConfig.chartVisibility)
    .reduce((accumulator, key) => {
      if (validatedConfig.chartVisibility[key] === false) {
        accumulator.push(`hide-${key}`);
      }
      return accumulator;
    }, [])
    .join(' ');

  const customChartsHtml = validatedConfig.customCharts
    .map(chart => {
      return `<div class="container ${chart.id}">
                <div class="stats-column">
                  <h5>${chart.title}</h5>
                  <h1 id="${chart.id}Stat">-</h1>
                </div>
                <div class="chart-container">
                  <canvas id="${chart.id}Chart" width="200" height="100"></canvas>
                </div>
              </div>`;
    })
    .join('');

  const appJsTmpl = fs
    .readFileSync(path.join(__dirname, '/public/javascripts/app.js'))
    .toString();

  const appJsScript = Handlebars
    .compile(appJsTmpl)({
      customCharts: JSON.stringify(validatedConfig.customCharts
        .map(chart => {
          return {
            id: chart.id,
            defaultValue: chart.defaultValue ? '' + chart.defaultValue : '-',
            decimalFixed: typeof chart.decimalFixed === 'number' ? chart.decimalFixed : 2,
            prefix: chart.prefix ? '' + chart.prefix : '',
            suffix: chart.suffix ? '' + chart.suffix : ''
          }
        }))
    });

  const data = {
    title: validatedConfig.title,
    port: validatedConfig.port,
    socketPath: validatedConfig.socketPath,
    bodyClasses,
    customCharts: customChartsHtml,
    script: appJsScript,
    style: fs.readFileSync(path.join(__dirname, '/public/stylesheets/', validatedConfig.theme))
  };

  const htmlTmpl = fs
    .readFileSync(path.join(__dirname, '/public/index.html'))
    .toString();

  const render = Handlebars.compile(htmlTmpl);

  const middleware = (req, res, next) => {
    socketIoInit(req.socket.server, validatedConfig);

    const startTime = process.hrtime();

    if (req.path === validatedConfig.path) {
      healthChecker(validatedConfig.healthChecks).then(results => {
        data.healthCheckResults = results;
        if (validatedConfig.iframe) {
          if (res.removeHeader) {
            res.removeHeader('X-Frame-Options');
          }

          if (res.remove) {
            res.remove('X-Frame-Options');
          }
        }

        res.send(render(data));
      });
    } else {
      if (!req.path.startsWith(validatedConfig.ignoreStartsWith)) {
        onHeaders(res, () => {
          onHeadersListener(res.statusCode, startTime, validatedConfig.spans);
        });
      }

      next();
    }
  };

  /* Provide two properties, the middleware and HTML page renderer separately
   * so that the HTML page can be authenticated while the middleware can be
   * earlier in the request handling chain.  Use like:
   * ```
   * const statusMonitor = require('express-status-monitor')(config);
   * server.use(statusMonitor);
   * server.get('/status', isAuthenticated, statusMonitor.pageRoute);
   * ```
   * discussion: https://github.com/RafalWilinski/express-status-monitor/issues/63
   */
  middleware.middleware = middleware;
  middleware.pageRoute = (req, res) => {
    healthChecker(validatedConfig.healthChecks).then(results => {
      data.healthCheckResults = results;
      res.send(render(data));
    });
  };
  return middleware;
};

module.exports = middlewareWrapper;
