//this file will hold the resources for the route paths beginning with /api/users
const express = require('express')
const { setTokenCookie, requireAuth, restoreUser } = require('../../utils/auth');
const { Spot, User, SpotImage, Review } = require('../../db/models');


//following two lines are from phase 5
const { check } = require('express-validator');
const { handleValidationErrors } = require('../../utils/validation');
const router = express.Router();

//in case we need these models
const {Model, Sequelize} = require('sequelize');

const validateSpot = [
    check('address').exists({checkFalsy: true}).withMessage('Street address is required'),
    check('city').exists({checkFalsy: true}).withMessage('City is required'),
    check('state').exists({checkFalsy: true}).withMessage('State is required'),
    check('country').exists({checkFalsy: true}).withMessage('Country is required'),
    check('lat').exists({checkFalsy: true}).toFloat().isDecimal().withMessage('Latitude is not valid'),
    check('lng').exists({checkFalsy: true}).toFloat().isDecimal().withMessage('Longitude is not valid'),
    check('name').exists({checkFalsy: true}).isLength({ min: 1, max: 49}).withMessage('Name must be less than 50 characters'),
    check('description').exists({checkFalsy: true}).withMessage('Description is required'),
    check('price').exists({checkFalsy: true}).withMessage('Price per day is required'),
    handleValidationErrors
]

//will have to create validation down the line for reviews

//will have to create validation down the line for bookings

//Get all spots
    //DOES NOT ASK FOR SPECIFIC ERROR RETURNS
    //Require Auth: false
router.get('/', async (req, res, next) => {
    const Spots = await Spot.findAll({
        //need to include Reviews table and SpotImages table
        attributes: [
            'id',
            'ownerId',
            'address',
            'city',
            'state',
            'country',
            'lat',
            'lng',
            'name',
            'description',
            'price',
            'createdAt',
            'updatedAt',
            //Old literal way
                // [Sequelize.literal('(SELECT AVG(stars) FROM Reviews WHERE Reviews.spotId = Spot.id)'), 'avgRating'],
                // [Sequelize.literal('(SELECT url FROM SpotImages WHERE SpotImages.spotId = Spot.id ORDER BY createdAt DESC LIMIT 1)'), 'previewImage']
            [Sequelize.fn('AVG', Sequelize.col('Reviews.stars')), 'avgRating'],
            //Since the SpotImages table has a createdAt column, MAX is applied there to get the image with the greatest createdAt value for each spot
            [Sequelize.fn('MAX', Sequelize.col('SpotImages.url')), 'previewImage']
        ],
        //must join Review and SpotImage tables so that I can use AVG and MAX functions
        include: [
            {
                model: Review,
                attributes: []
            },
            {
                model: SpotImage,
                attributes: []
            }
        ],
        //group by Spot.id, SpotImages.id, Reviews.spotId
        group: ['Spot.id', 'SpotImages.id', 'Reviews.spotId']
    })

    if (Spots) {
        return res.status(200).json({Spots})
    } else {
        res.status(400).json({message: "There are no spots available."})
    }
})

//Get all spots owned by the current user
    //REQUIRE AUTH: TRUE
    //NEED TO GET 'Spots' ARRAY TO SHOW
router.get('/current', requireAuth, async (req, res, next) => {
    //if user is authenticated, findAll spots that belong to user from Spot model
    const usersSpots = await Spot.findAll({
        //filter spots by authenticated user's id
        where: {ownerId: req.user.id},
        attributes: [
            //specify which columns to include in the result set
            'id',
            'ownerId',
            'address',
            'city',
            'state',
            'country',
            'lat',
            'lng',
            'name',
            'description',
            'price',
            'createdAt',
            'updatedAt',
            [Sequelize.fn('AVG', Sequelize.col('Reviews.stars')), 'avgRating'],
            [Sequelize.fn('MAX', Sequelize.col('SpotImages.url')), 'previewImage']
        ],
        //specify models to eager load, only including respective foreign keys
            //this way we can use the JOIN to fetch reviews and images for each spot without having to include full details
        include: [
            {
                model: Review,
                attributes: []
            },
            {
                model: SpotImage,
                attributes: []
            }
        ],
        group: ['Spot.id', 'SpotImages.id', 'Reviews.spotId']
    })
    //if there were spots, return usersSpots with 200 code
    if (usersSpots) {
        //easy way to get array of spots as part of JSON response is to wrap usersSpots array in an object with the key of Spots
        return res.status(200).json({Spots: usersSpots});
    }
    //NO SPECIFICS ON WHAT ERROR THEY WANT RETURNED
    res.status(404).json({'message': 'This user did not have any spots'})
})


//Get details of a spot by spotId //ON POSTMAN, THIS WORKS IF I SPECIFY SPOT MYSELF BUT NOT IF I LEAVE THE SQUIGGLY SPOTID REQUEST
    //REQUIRE AUTH: FALSE
    //error message suggests to me that the spotId is not an integer
router.get('/:spotId', async (req, res, next) => {
    //use findByPk() on Spot model to find spot with Id from URL parameter
    const specificSpot = await Spot.findByPk(req.params.spotId, {
        attributes: [
            'id',
            'ownerId',
            'address',
            'city',
            'state',
            'country',
            'lat',
            'lng',
            'name',
            'description',
            'price',
            'createdAt',
            'updatedAt',
            //THIS TIME THEY WANT THE TOTAL NUMBER OF REVIEWS, THEN AVG
            [Sequelize.fn('COUNT', Sequelize.col('Reviews.id')), 'numReviews'],
            [Sequelize.fn('AVG', Sequelize.col('Reviews.stars')), 'avgStarRating']
        ],
        //specify which models to eager load
        include: [
            {
                model: Review,
                attributes: []
            },
            {
                model: SpotImage,
                attributes: ['id', 'url', 'preview']
            },
            {
                model: User,
                as: 'Owner',
                attributes: ['id', 'firstName', 'lastName']
            }
        ],
        group: ['Spot.id', 'SpotImages.id', 'Owner.id', 'Reviews.spotId']
    })
    //if the specified spot was found, respond with status code 200 and JSON body
    if (specificSpot) {
        return res.status(200).json(specificSpot)
    }
    //if not, return 404 with specific message and statusCode
    return res.status(404).json({message: "Spot couldn't be found", statusCode: 404})
})


//Create a spot
    //Price accepts a string at the moment
    //REQUIRE AUTH MUST BE TRUE
router.post('/', requireAuth, validateSpot, async (req, res, next) => {
    //if user is authenticated,
    if (req.user) {
        //check if there is an existing Spot in the database using findAll
        const Locations = await Spot.findAll();

        //extract required fields for creating new Spot from req.body
        const {
            address,
            city,
            state,
            country,
            lat,
            lng,
            name,
            description,
            price
        } = req.body;

        //if there was an existing location, we can check who owns that location
        if (Locations) {
            //retrieve current location owner from req.user object
            //must be ownerId because it could be used to associate a spot with its owner
                //if a user is the owner of a spot, they may have certain permissions that non-owners do not have
                    //such as the abilty to edit or delete a spot
            const ownerId = req.user.id

            //call Spot.create with extracted fields and ownerId
            const newLocation = await Spot.create({
                ownerId,
                address,
                city,
                state,
                country,
                lat,
                lng,
                name,
                description,
                price
            })

            //if the newLocation was successfully created, return a 201 status code with JSON of new location
            if (newLocation) return res.status(201).json(newLocation);
        }
    }
})


//Add image to a spot based on Spot's id
router.post('/:spotId/images', requireAuth, async (req, res, next) => {
    //extract url and preview from request body
    const {url, preview} = req.body

    //find spot with given id using findOne()
    const spot = await Spot.findOne({
        where: {id: req.params.spotId}
    });

    //if there is no spot, return a 404
    if (!spot) {
        return res.status(404).json({
            message: "Spot couldn't be found",
            statusCode: 404
        })
    }

    // //check for user authorization
    // const authorized = await Spot.findOne({
    //     where: {ownerId: req.user.id, id: req.params.spotId}
    // })

    // //if the user is not authorized, return a 403 with 'Forbidden' message
    // if (!authorized) {
    //     return res.status(403).json({
    //         message: 'Forbidden',
    //         statusCode: 403
    //     })
    // }

    //if the user is authorized and there is a spot, create a record in SpotImage
    const image = await SpotImage.create({
        spotId: parseInt(req.params.spotId),
        url,
        preview
    })

    //if image was successfully added as a record in SpotImage, return status 200 with JSON of the image
    if (image) return res.status(200).json({
        id: image.id,
        url: image.url,
        preview: image.preview
    });


})

//Edit a spot

//Delete a spot

module.exports = router;
