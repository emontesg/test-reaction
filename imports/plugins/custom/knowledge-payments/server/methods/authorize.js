Meteor.methods({
  // arguments @param OBJECT Parameters using hashitis pattern.
  'knoledgePayments/authorize': function(arguments){

    //TODO SS: Remove exesive logging.
    console.log('Knoledge Method Started');
    console.log(arguments);

    // TODO SS: check each argument. At the time being we don't know the arguments.
    check(arguments, Object);

    try{
      const response = HTTP.get('https://jsonplaceholder.typicode.com/posts/1');
    } catch(error){
      console.error(error);
      throw new Meteor.Error('API error', error);
    }
    return true;
  }
});
