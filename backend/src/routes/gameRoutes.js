'use strict';

const express = require('express');
const controller = require('../controllers/gameController');

const router = express.Router();

router.post('/games', controller.createGame);
router.get('/games/:id', controller.getGame);
router.post('/games/:id/join', controller.joinGame);
router.post('/games/:id/start', controller.startGame);
router.post('/games/:id/leave', controller.leaveGame);

router.post('/games/:id/action/pick-factory', controller.pickFromFactory);
router.post('/games/:id/action/pick-center', controller.pickFromCenter);
router.post('/games/:id/action/place', controller.placeSelection);

module.exports = router;
