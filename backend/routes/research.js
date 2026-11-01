'use strict';
const router = require('express').Router();
const research = require('../controllers/researchController');
const sources = require('../controllers/sourceController');
const analysis = require('../controllers/analysisController');
const checklist = require('../controllers/checklistController');
const report = require('../controllers/reportController');
const rv = require('../validators/research');
const cv = require('../validators/checklist');
const { idParam } = require('../validators/common');
const validate = require('../middleware/validate');
const { heavyLimiter } = require('../middleware/rateLimiters');

router.get('/', rv.listResearch, validate, research.list);
router.post('/', rv.createResearch, validate, research.create);
router.get('/:id', idParam(), validate, research.getOne);
router.patch('/:id', rv.updateResearch, validate, research.update);
router.delete('/:id', idParam(), validate, research.remove);

router.get('/:id/sources', idParam(), validate, sources.list);
router.post('/:id/sources', rv.addSource, validate, sources.add);

router.post('/:id/analyze', idParam(), validate, heavyLimiter, analysis.analyze);
router.get('/:id/analysis', idParam(), validate, analysis.getAnalysis);
router.get('/:id/gaps', idParam(), validate, analysis.gaps);
router.get('/:id/conflicts', idParam(), validate, analysis.conflicts);
router.get('/:id/outdated', idParam(), validate, analysis.outdated);
router.get('/:id/evidence', idParam(), validate, analysis.evidence);
router.get('/:id/coverage', idParam(), validate, analysis.coverage);

router.get('/:id/checklist', idParam(), validate, checklist.list);
router.post('/:id/checklist', cv.create, validate, checklist.create);
router.patch('/:id/checklist/:taskId', cv.update, validate, checklist.update);
router.delete('/:id/checklist/:taskId', cv.remove, validate, checklist.remove);

router.get('/:id/report', idParam(), validate, heavyLimiter, report.download);

module.exports = router;
