'use strict';

const passport = require('../../lib/passport');
const templates = require('../../models/templates');

const router = require('../../lib/router-async').create();
const {castToInteger} = require('../../lib/helpers');

router.getAsync('/templates/:templateId', passport.loggedIn, async (req, res) => {
    const template = await templates.getById(req.context, castToInteger(req.params.templateId));
    template.hash = templates.hash(template);
    return res.json(template);
});

router.postAsync('/templates', passport.loggedIn, passport.csrfProtection, async (req, res) => {
    return res.json(await templates.create(req.context, req.body));
});

router.putAsync('/templates/:templateId', passport.loggedIn, passport.csrfProtection, async (req, res) => {
    const template = req.body;
    template.id = castToInteger(req.params.templateId);

    await templates.updateWithConsistencyCheck(req.context, template);
    return res.json();
});

router.deleteAsync('/templates/:templateId', passport.loggedIn, passport.csrfProtection, async (req, res) => {
    await templates.remove(req.context, castToInteger(req.params.templateId));
    return res.json();
});

router.postAsync('/templates-table', passport.loggedIn, async (req, res) => {
    return res.json(await templates.listDTAjax(req.context, req.body));
});

router.getAsync('/template-params/:templateId', passport.loggedIn, async (req, res) => {
    const params = await templates.getParamsById(req.context, castToInteger(req.params.templateId));
    return res.json(params);
});

router.postAsync('/template-build/:templateId', passport.loggedIn, async (req, res) => {
    const params = await templates.compile(req.context, castToInteger(req.params.templateId));
    return res.json(params);
});

router.getAsync('/template-module/:templateId', passport.loggedIn, async (req, res) => {
    const module = await templates.getModuleById(req.context, castToInteger(req.params.templateId));
    res.type('text/javascript');
    return res.send(module);
});

module.exports = router;