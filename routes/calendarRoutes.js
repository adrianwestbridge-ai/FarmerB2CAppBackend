const express = require('express');
const router = express.Router();
const calendarController = require('../controllers/calendarController');

// Get today's highlight
router.get('/today', calendarController.getTodayEvent);

// Get events for a specific month (e.g., /api/calendar/month/4)
router.get('/month/:month', calendarController.getEventsByMonth);

// Filtered search (e.g., /api/calendar/search?category=National&region=India)
router.get('/search', calendarController.searchEvents);

// Admin: Add new calendar entry
router.post('/', calendarController.addEvent);

module.exports = router;